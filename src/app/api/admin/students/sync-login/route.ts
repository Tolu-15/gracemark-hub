import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

/**
 * POST { student_id, new_email } — keeps a student's login email in sync
 * with their record (e.g. after an admission number edit changes what their
 * email should be). Editing a student's admission_no previously only
 * touched the students row; the linked users/auth.users email was never
 * updated, so the old email (and whichever other account happened to be
 * using it) stayed attached. This is the single place that email change
 * should ever go through, so it can check for collisions first.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const studentId = String(body?.student_id || "").trim();
  const newEmail = String(body?.new_email || "").trim().toLowerCase();
  if (!studentId || !newEmail) {
    return NextResponse.json({ ok: false, error: "student_id and new_email are required." }, { status: 400 });
  }

  const { data: student, error: stErr } = await service.from("students").select("id, user_id, name, full_name").eq("id", studentId).maybeSingle();
  if (stErr) return NextResponse.json({ ok: false, error: stErr.message }, { status: 500 });
  if (!student) return NextResponse.json({ ok: false, error: "Student not found." }, { status: 404 });

  const { data: user, error: userErr } = await service.from("users").select("id, auth_id, email").eq("id", student.user_id).maybeSingle();
  if (userErr) return NextResponse.json({ ok: false, error: userErr.message }, { status: 500 });
  if (!user) return NextResponse.json({ ok: false, error: "This student has no login account to update." }, { status: 404 });

  if (user.email?.toLowerCase() === newEmail) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  // Never silently steal another account's email — surface it instead of
  // repeating the exact bug this route exists to fix.
  const { data: collision } = await service.from("users").select("id, display_name").eq("email", newEmail).neq("id", user.id).maybeSingle();
  if (collision) {
    return NextResponse.json(
      { ok: false, error: `That login email is already used by another account (${collision.display_name || "another user"}). Resolve that first.` },
      { status: 409 }
    );
  }

  const { error: authErr } = await service.auth.admin.updateUserById(user.auth_id, { email: newEmail, email_confirm: true });
  if (authErr) return NextResponse.json({ ok: false, error: authErr.message }, { status: 500 });

  const { error: dbErr } = await service.from("users").update({ email: newEmail }).eq("id", user.id);
  if (dbErr) return NextResponse.json({ ok: false, error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, email: newEmail });
}
