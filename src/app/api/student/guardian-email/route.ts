import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { resolveStudentRecord } from "@/lib/cbtAuth";

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

  const { error } = await actor.service
    .from("students")
    .update({ guardian_email: guardianEmail || null })
    .eq("id", student.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, guardian_email: guardianEmail || null });
}
