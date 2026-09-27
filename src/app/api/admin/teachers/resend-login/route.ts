import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { sendTeacherWelcomeEmail } from "@/lib/email";

const GOOGLE_FORM_URL = "https://forms.gle/bhiJ4CUkXJbHRP5p6";
/** Same initial password new teachers are created with. */
const INITIAL_PASSWORD = "gracemark";

/** Teachers who have not completed first sign-in (they still must change their initial password). */
async function listPendingTeachers(service: any) {
  const { data, error } = await service
    .from("users")
    .select("id, auth_id, staff_id, display_name, email, status, must_change_password")
    .eq("role", "teacher")
    .eq("must_change_password", true)
    .eq("status", "active")
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data || []) as any[];
}

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const pending = await listPendingTeachers(service);
    const teachers = await Promise.all(
      pending.map(async (t) => {
        let lastSignIn: string | null = null;
        try {
          const { data } = await service.auth.admin.getUserById(t.auth_id);
          lastSignIn = data?.user?.last_sign_in_at || null;
        } catch {}
        return {
          teacherId: t.id,
          name: t.display_name || t.email || "Teacher",
          staffId: t.staff_id,
          email: t.email,
          lastSignIn,
        };
      })
    );
    return NextResponse.json({ ok: true, teachers });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

/** Body: { teacherIds?: string[] } — defaults to every teacher who has not done first sign-in. */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  if (!process.env.BREVO_API_KEY) {
    return NextResponse.json({ ok: false, error: "Email is not configured (BREVO_API_KEY is missing)." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const wanted: string[] | null = Array.isArray(body?.teacherIds) && body.teacherIds.length ? body.teacherIds : null;

  try {
    // Only ever touch teachers who still haven't completed first sign-in.
    const pending = (await listPendingTeachers(service)).filter((t) => !wanted || wanted.includes(t.id));

    const sentNames: string[] = [];
    const failed: { name: string; error: string }[] = [];

    for (const t of pending) {
      const name = t.display_name || t.email || "Teacher";
      if (!t.email || !t.staff_id) {
        failed.push({ name, error: "Missing email or staff ID" });
        continue;
      }
      try {
        // Passwords are stored hashed, so the initial one is re-issued rather than looked up.
        const { error: pwErr } = await service.auth.admin.updateUserById(t.auth_id, { password: INITIAL_PASSWORD });
        if (pwErr) throw pwErr;

        await sendTeacherWelcomeEmail({
          toEmail: t.email,
          name,
          staffId: t.staff_id,
          password: INITIAL_PASSWORD,
          formUrl: GOOGLE_FORM_URL,
        });
        sentNames.push(name);
      } catch (err: any) {
        failed.push({ name, error: err.message || "Send failed" });
      }
    }

    return NextResponse.json({ ok: true, sent: sentNames.length, sentNames, failed });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
