import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { resolveStudentRecord } from "@/lib/cbtAuth";
import { sendGuardianWelcomeEmail } from "@/lib/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POST { guardian_email } — lets the signed-in student set their own guardian's email, used for result-publish notifications. */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;

  const body = await req.json().catch(() => null);
  const guardianEmail = String(body?.guardian_email ?? "").trim();
  if (guardianEmail && !EMAIL_RE.test(guardianEmail)) {
    return NextResponse.json({ ok: false, error: "That doesn't look like a valid email address." }, { status: 400 });
  }

  const student = await resolveStudentRecord(actor);
  if (!student) return NextResponse.json({ ok: false, error: "Student profile not found." }, { status: 404 });

  const { data: current } = await actor.service
    .from("students")
    .select("name, full_name, guardian_email, guardian_welcome_sent_at, classes:class_id(name)")
    .eq("id", student.id)
    .maybeSingle();

  const next = guardianEmail || null;
  const needsWelcome = Boolean(next) && (next !== current?.guardian_email || !current?.guardian_welcome_sent_at);

  const { error } = await actor.service
    .from("students")
    .update({ guardian_email: next, ...(needsWelcome || !next ? { guardian_welcome_sent_at: null } : {}) })
    .eq("id", student.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let welcomeSent = false;
  if (next && needsWelcome) {
    try {
      await sendGuardianWelcomeEmail({
        guardianEmail: next,
        studentName: current?.full_name || current?.name || student.name,
        className: (current as any)?.classes?.name || "their class",
      });
      await actor.service.from("students").update({ guardian_welcome_sent_at: new Date().toISOString() }).eq("id", student.id);
      welcomeSent = true;
    } catch (mailErr) {
      console.warn("Guardian welcome email failed:", mailErr);
    }
  }

  return NextResponse.json({ ok: true, guardian_email: next, welcomeSent });
}
