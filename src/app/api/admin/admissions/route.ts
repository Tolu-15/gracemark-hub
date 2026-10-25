import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { approvedMessage, emailParent, enrolApplicant, enrolledMessage, rejectedMessage } from "@/lib/admissionsServer";

const STATUSES = ["draft", "submitted", "under_review", "approved", "rejected", "enrolled"] as const;
const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

/**
 * GET   Every application with its payment, class and (once enrolled) the student it became, plus
 *       counts per stage. "draft" means the application fee has not been paid yet.
 * POST  { id, action, ... } moves one application along:
 *         review                         submitted -> under review
 *         approve                        submitted/under review -> approved (parent is emailed)
 *         reject   { reason? }           -> rejected (parent is emailed; the application fee stays)
 *         enrol    { admission_no, class_id }  approved -> a real student: login, record and enrolment
 *       The admin chooses the admission number. Every action is audit-logged.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const { data: rows, error } = await service.from("admissions").select("*").order("created_at", { ascending: false }).limit(1000);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const apps = rows || [];

  const paymentIds = apps.map((a: any) => a.admission_payment_id).filter(Boolean);
  const studentIds = apps.map((a: any) => a.created_student_id).filter(Boolean);
  const [{ data: payments }, { data: students }, { data: classes }] = await Promise.all([
    paymentIds.length ? service.from("admission_payments").select("id, status, amount, paid_at, payment_reference").in("id", paymentIds) : Promise.resolve({ data: [] as any[] }),
    studentIds.length ? service.from("students").select("id, admission_no").in("id", studentIds) : Promise.resolve({ data: [] as any[] }),
    service.from("classes").select("id, name").order("display_order"),
  ]);
  const payment = new Map((payments || []).map((p: any) => [p.id, p]));
  const student = new Map((students || []).map((s: any) => [s.id, s]));
  const className = new Map((classes || []).map((c: any) => [c.id, c.name]));

  const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const applications = apps.map((a: any) => {
    counts[a.status] = (counts[a.status] || 0) + 1;
    const pay = payment.get(a.admission_payment_id) as any;
    return {
      id: a.id,
      applicationNumber: a.application_number,
      status: a.status,
      surname: a.surname,
      firstNames: a.first_names,
      gender: a.gender,
      dateOfBirth: a.date_of_birth,
      stateOfOrigin: a.state_of_origin,
      homeAddress: a.home_address,
      passportUrl: a.passport_url,
      previousSchool: a.previous_school_name,
      previousClass: a.previous_class,
      isBoarding: a.is_boarding,
      boardingType: a.boarding_type,
      medicalConditions: a.medical_conditions,
      desiredClassId: a.desired_class_id,
      desiredClass: className.get(a.desired_class_id) || "",
      parentName: a.parent_name,
      parentPhone: a.parent_phone,
      parentEmail: a.parent_email,
      parentOccupation: a.parent_occupation,
      paid: pay ? { status: pay.status, amount: Number(pay.amount), paidAt: pay.paid_at } : null,
      createdAt: a.created_at,
      reviewedAt: a.reviewed_at,
      rejectionReason: a.rejection_reason,
      studentId: a.created_student_id,
      studentAdmissionNo: (student.get(a.created_student_id) as any)?.admission_no || null,
    };
  });

  return NextResponse.json({ ok: true, counts, applications, classes: classes || [] });
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service, dbUserId } = actor;

  const body = await req.json().catch(() => null);
  const id = String(body?.id || "");
  const action = String(body?.action || "");
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });

  const { data: a } = await service.from("admissions").select("id, status, application_number, surname, first_names, parent_email, desired_class_id, created_student_id").eq("id", id).maybeSingle();
  if (!a) return NextResponse.json({ ok: false, error: "Application not found." }, { status: 404 });
  const applicant = `${a.surname} ${a.first_names}`.trim();
  const desired = a.desired_class_id ? one((await service.from("classes").select("name").eq("id", a.desired_class_id).maybeSingle()).data)?.name || "" : "";
  const stamp = { reviewed_by: dbUserId ?? null, reviewed_at: new Date().toISOString() };

  if (a.status === "draft") {
    return NextResponse.json({ ok: false, error: "The application fee has not been paid yet, so this application cannot be processed." }, { status: 409 });
  }

  if (action === "review") {
    if (a.status !== "submitted") return NextResponse.json({ ok: false, error: "Only a newly submitted application can be moved to review." }, { status: 409 });
    const { error } = await service.from("admissions").update({ status: "under_review", ...stamp }).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await logAudit(actor, { action: "admissions.review", entityType: "admission", entityId: id, summary: `Started reviewing ${applicant} (${a.application_number})` });
    return NextResponse.json({ ok: true, status: "under_review" });
  }

  if (action === "approve") {
    if (a.status !== "submitted" && a.status !== "under_review") return NextResponse.json({ ok: false, error: `A ${a.status.replace("_", " ")} application cannot be approved.` }, { status: 409 });
    const { error } = await service.from("admissions").update({ status: "approved", rejection_reason: null, ...stamp }).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const m = approvedMessage(applicant, desired, a.application_number);
    const emailed = await emailParent(a.parent_email, m.subject, m.message);
    await logAudit(actor, { action: "admissions.approve", entityType: "admission", entityId: id, summary: `Approved ${applicant} (${a.application_number})${emailed ? "; parent emailed" : ""}`, metadata: { emailed } });
    return NextResponse.json({ ok: true, status: "approved", emailed });
  }

  if (action === "reject") {
    if (a.status === "enrolled" || a.created_student_id) return NextResponse.json({ ok: false, error: "An enrolled applicant cannot be rejected." }, { status: 409 });
    const reason = String(body?.reason || "").trim().slice(0, 500);
    const { error } = await service.from("admissions").update({ status: "rejected", rejection_reason: reason || null, ...stamp }).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const m = rejectedMessage(applicant, a.application_number, reason);
    const emailed = await emailParent(a.parent_email, m.subject, m.message);
    await logAudit(actor, { action: "admissions.reject", entityType: "admission", entityId: id, summary: `Rejected ${applicant} (${a.application_number})${reason ? `: ${reason}` : ""}`, metadata: { emailed, reason } });
    return NextResponse.json({ ok: true, status: "rejected", emailed });
  }

  if (action === "enrol") {
    const result = await enrolApplicant(service, { admissionId: id, admissionNo: String(body?.admission_no || ""), classId: String(body?.class_id || a.desired_class_id || ""), adminUserId: dbUserId });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    const m = enrolledMessage(result.name, result.className, result.admissionNo);
    const emailed = await emailParent(a.parent_email, m.subject, m.message);
    await logAudit(actor, {
      action: "admissions.enrol",
      entityType: "admission",
      entityId: id,
      summary: `Enrolled ${result.name} as ${result.admissionNo} in ${result.className} (${a.application_number})${emailed ? "; parent emailed" : ""}`,
      metadata: { studentId: result.studentId, admissionNo: result.admissionNo, emailed },
    });
    return NextResponse.json({ ok: true, status: "enrolled", emailed, student: { id: result.studentId, name: result.name, admissionNo: result.admissionNo, className: result.className }, warning: result.warning });
  }

  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
