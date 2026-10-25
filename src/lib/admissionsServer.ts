import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmailConfigured, sendCustomEmail } from "@/lib/email";
import { getCurrentSessionAndTerm } from "@/lib/financeServer";

/** The password the school hands out; signing in with it forces the student to choose their own. */
export const DEFAULT_STUDENT_PASSWORD = "gracemark";
const PORTAL_URL = "https://www.gracemarkportal.com.ng/";
const ADMISSION_NO_RE = /^[A-Za-z0-9][A-Za-z0-9\-/]{1,29}$/;

export const loginEmailFor = (admissionNo: string) => `${admissionNo.trim().replace(/[^A-Z0-9]/gi, "").toLowerCase()}@student.gracemark.edu.ng`;

const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

/** Email to the parent. Best effort: returns whether it was sent, never throws. */
export async function emailParent(to: string | null | undefined, subject: string, message: string): Promise<boolean> {
  if (!to || !isEmailConfigured()) return false;
  try {
    await sendCustomEmail({ toEmail: to, subject, message });
    return true;
  } catch (err) {
    console.warn("Admission email failed:", (err as Error)?.message);
    return false;
  }
}

export const approvedMessage = (applicant: string, cls: string, appNo: string) => ({
  subject: `Gracemark Academy: application approved (${appNo})`,
  message:
    `We are pleased to tell you that the application for ${applicant}${cls ? ` to join ${cls}` : ""} has been approved.\n\n` +
    `Application number: ${appNo}\n\nThe school office will contact you about the next steps and will send the portal login details once ${applicant} is enrolled.`,
});

export const rejectedMessage = (applicant: string, appNo: string, reason: string) => ({
  subject: `Gracemark Academy: update on application ${appNo}`,
  message:
    `Thank you for applying to Gracemark Academy for ${applicant}. After review, we are unable to offer a place at this time.` +
    (reason ? `\n\nReason: ${reason}` : "") +
    `\n\nApplication number: ${appNo}\nThe application fee is not refundable. Please contact the school office if you have any questions.`,
});

export const enrolledMessage = (applicant: string, cls: string, admissionNo: string) => ({
  subject: `Gracemark Academy: ${applicant} is enrolled`,
  message:
    `${applicant} has been enrolled${cls ? ` in ${cls}` : ""} at Gracemark Academy. Welcome!\n\n` +
    `Student portal: ${PORTAL_URL}\nAdmission number: ${admissionNo}\nPassword: ${DEFAULT_STUDENT_PASSWORD}\n\n` +
    `Sign in with the admission number and this password. You will be asked to choose a new password the first time, so please keep it private.`,
});

export type EnrolResult =
  | { ok: true; studentId: string; name: string; admissionNo: string; className: string; warning?: string }
  | { ok: false; status: number; error: string };

/**
 * Turns an approved application into a real student in one step: login, student record, enrollment in
 * the current session, and the link back to the application. If any step fails, what was created is
 * removed again, so a failed enrolment never leaves a half-made student or an orphaned login.
 */
export async function enrolApplicant(
  service: SupabaseClient,
  p: { admissionId: string; admissionNo: string; classId: string; adminUserId?: string }
): Promise<EnrolResult> {
  const admissionNo = p.admissionNo.trim();
  if (!ADMISSION_NO_RE.test(admissionNo)) {
    return { ok: false, status: 400, error: "The admission number can use letters, numbers, - and / only (2 to 30 characters)." };
  }

  const { data: a } = await service.from("admissions").select("*").eq("id", p.admissionId).maybeSingle();
  if (!a) return { ok: false, status: 404, error: "Application not found." };
  if (a.created_student_id) return { ok: false, status: 409, error: "This applicant has already been enrolled." };
  if (a.status !== "approved") return { ok: false, status: 409, error: "Approve the application before enrolling." };

  const { data: cls } = await service.from("classes").select("id, name").eq("id", p.classId).maybeSingle();
  if (!cls) return { ok: false, status: 400, error: "Choose a class." };

  const { sessionId } = await getCurrentSessionAndTerm(service);
  if (!sessionId) return { ok: false, status: 400, error: "No current session is set. Set one on the dashboard first." };

  const loginEmail = loginEmailFor(admissionNo);
  const [{ data: sameNo }, { data: sameLogin }] = await Promise.all([
    service.from("students").select("id").ilike("admission_no", admissionNo).maybeSingle(),
    service.from("users").select("id").eq("email", loginEmail).maybeSingle(),
  ]);
  if (sameNo || sameLogin) return { ok: false, status: 409, error: `Admission number ${admissionNo} is already in use. Choose a different one.` };

  const fullName = `${a.surname} ${a.first_names}`.trim();

  const { data: created, error: authErr } = await service.auth.admin.createUser({
    email: loginEmail,
    password: DEFAULT_STUDENT_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: fullName, role: "student" },
  });
  if (authErr || !created?.user?.id) {
    return { ok: false, status: 500, error: `Could not create the login: ${authErr?.message || "unknown error"}` };
  }
  const authId = created.user.id;

  let userId: string | undefined;
  let studentId: string | undefined;
  const undo = async () => {
    if (studentId) await service.from("students").delete().eq("id", studentId);
    if (userId) await service.from("users").delete().eq("id", userId);
    await service.auth.admin.deleteUser(authId);
  };

  try {
    const { data: userRow, error: userErr } = await service
      .from("users")
      .upsert({ auth_id: authId, email: loginEmail, display_name: fullName, role: "student", status: "active", must_change_password: true }, { onConflict: "auth_id" })
      .select("id")
      .single();
    if (userErr || !userRow) throw new Error(userErr?.message || "Could not create the user profile.");
    userId = userRow.id;

    const { data: student, error: studentErr } = await service
      .from("students")
      .insert({
        full_name: fullName,
        name: fullName,
        admission_no: admissionNo,
        user_id: userId,
        gender: a.gender,
        date_of_birth: a.date_of_birth,
        guardian_name: a.parent_name,
        guardian_phone: a.parent_phone,
        guardian_email: a.parent_email,
        passport_url: a.passport_url,
        class_id: cls.id,
        current_class_id: cls.id,
        portal_access_status: "active",
      })
      .select("id")
      .single();
    if (studentErr || !student) throw new Error(studentErr?.message || "Could not create the student record.");
    studentId = student.id;

    const { error: enrolErr } = await service
      .from("student_enrollments")
      .upsert({ student_id: studentId, academic_session_id: sessionId, class_id: cls.id }, { onConflict: "student_id,academic_session_id" });
    if (enrolErr) throw new Error(`Could not enrol in the current session: ${enrolErr.message}`);
  } catch (err: any) {
    await undo();
    return { ok: false, status: 500, error: err?.message || "Could not enrol the applicant." };
  }

  const { error: linkErr } = await service
    .from("admissions")
    .update({ status: "enrolled", created_student_id: studentId, reviewed_by: p.adminUserId ?? null, reviewed_at: new Date().toISOString() })
    .eq("id", p.admissionId);

  return {
    ok: true,
    studentId: studentId!,
    name: fullName,
    admissionNo,
    className: cls.name,
    ...(linkErr ? { warning: `The student was created, but the application could not be marked enrolled: ${linkErr.message}` } : {}),
  };
}

export { one };
