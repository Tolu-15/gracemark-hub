import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { resolveStudentRecord } from "@/lib/cbtAuth";
import { finalizeSubmission } from "@/lib/cbtSubmit";

const GRACE_MS = 5 * 60 * 1000;

/** POST { sessionId, answers: {[questionId]: string}, tabSwitches } */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const sessionId = body?.sessionId;
  const answers: Record<string, string> = body?.answers && typeof body.answers === "object" ? body.answers : {};
  const tabSwitches = Number(body?.tabSwitches) || 0;
  if (!sessionId) return NextResponse.json({ ok: false, error: "sessionId is required." }, { status: 400 });

  const student = await resolveStudentRecord(actor);
  if (!student) return NextResponse.json({ ok: false, error: "Student profile not found." }, { status: 404 });

  const { data: session } = await service.from("cbt_sessions").select("*").eq("id", sessionId).eq("student_id", student.id).maybeSingle();
  if (!session) return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });
  if (session.submitted_at) return NextResponse.json({ ok: false, error: "This attempt has already been submitted." }, { status: 409 });

  const { data: exam } = await service.from("cbt_exams").select("*").eq("id", session.exam_id).maybeSingle();
  if (!exam) return NextResponse.json({ ok: false, error: "Exam not found." }, { status: 404 });

  const timeExpired = session.expires_at ? Date.now() > new Date(session.expires_at).getTime() + GRACE_MS : false;

  try {
    const result = await finalizeSubmission({
      service,
      exam,
      session,
      studentId: student.id,
      answers,
      tabSwitches,
      forceZero: timeExpired,
      integrityFlags: timeExpired ? ["time_expired"] : [],
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("CBT submit error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Could not submit the exam." }, { status: 500 });
  }
}
