import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { resolveStudentRecord } from "@/lib/cbtAuth";

const GRACE_MS = 5 * 60 * 1000;

/** GET ?sessionId= — question content for an open, non-expired session (no correct_answer/explanation). */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ ok: false, error: "sessionId is required." }, { status: 400 });

  const student = await resolveStudentRecord(actor);
  if (!student) return NextResponse.json({ ok: false, error: "Student profile not found." }, { status: 404 });

  const { data: session } = await service.from("cbt_sessions").select("*").eq("id", sessionId).eq("student_id", student.id).maybeSingle();
  if (!session) return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });
  if (session.submitted_at) return NextResponse.json({ ok: false, error: "This attempt has already been submitted." }, { status: 409 });
  if (session.expires_at && Date.now() > new Date(session.expires_at).getTime() + GRACE_MS) {
    return NextResponse.json({ ok: false, error: "This attempt has expired." }, { status: 409 });
  }

  const { data: exam } = await service.from("cbt_exams").select("id, title, duration_minutes, pass_mark").eq("id", session.exam_id).maybeSingle();
  const { data: questions } = await service
    .from("cbt_questions")
    .select("id, question_text, question_type, options, points, position")
    .eq("exam_id", session.exam_id)
    .order("position", { ascending: true });

  const secondsLeft = session.expires_at ? Math.max(0, Math.round((new Date(session.expires_at).getTime() - Date.now()) / 1000)) : null;

  return NextResponse.json({ ok: true, exam, questions: questions || [], secondsLeft });
}
