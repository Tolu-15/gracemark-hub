import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { resolveStudentRecord } from "@/lib/cbtAuth";
import { finalizeSubmission } from "@/lib/cbtSubmit";

const GRACE_MS = 5 * 60 * 1000;

/** POST { examId, resumeOnly? } — starts a new timed session, or resumes an already-open one. */
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
  const examId = body?.examId;
  const resumeOnly = Boolean(body?.resumeOnly);
  if (!examId) return NextResponse.json({ ok: false, error: "examId is required." }, { status: 400 });

  const student = await resolveStudentRecord(actor);
  if (!student) return NextResponse.json({ ok: false, error: "Student profile not found." }, { status: 404 });

  const { data: exam } = await service.from("cbt_exams").select("*").eq("id", examId).maybeSingle();
  if (!exam) return NextResponse.json({ ok: false, error: "Exam not found." }, { status: 404 });
  if (exam.class_id !== student.class_id) return NextResponse.json({ ok: false, error: "This exam is not available to your class." }, { status: 403 });

  // Reap an abandoned session (past its expiry + grace, never submitted) before deciding anything else.
  const { data: openSession } = await service
    .from("cbt_sessions")
    .select("*")
    .eq("exam_id", examId)
    .eq("student_id", student.id)
    .is("submitted_at", null)
    .maybeSingle();

  if (openSession) {
    const expired = openSession.expires_at && Date.now() > new Date(openSession.expires_at).getTime() + GRACE_MS;
    if (!expired) {
      const secondsLeft = openSession.expires_at ? Math.max(0, Math.round((new Date(openSession.expires_at).getTime() - Date.now()) / 1000)) : null;
      return NextResponse.json({
        ok: true,
        sessionId: openSession.id,
        startedAt: openSession.started_at,
        expiresAt: openSession.expires_at,
        secondsLeft,
        resumed: true,
        resumable: true,
      });
    }
    // Past grace and never submitted: close it out as a zero/abandoned attempt so it can't be reused as a free retry.
    try {
      await finalizeSubmission({
        service,
        exam,
        session: openSession,
        studentId: student.id,
        answers: {},
        tabSwitches: 0,
        forceZero: true,
        integrityFlags: ["abandoned"],
      });
    } catch (err) {
      console.warn("Could not reap abandoned CBT session:", err);
      await service.from("cbt_sessions").update({ submitted_at: new Date().toISOString() }).eq("id", openSession.id);
    }
  }

  if (resumeOnly) {
    return NextResponse.json({ ok: true, resumable: false });
  }

  if (!exam.is_published) return NextResponse.json({ ok: false, error: "This exam is not open yet." }, { status: 403 });
  if (exam.due_date && Date.now() > new Date(exam.due_date).getTime()) {
    return NextResponse.json({ ok: false, error: "The deadline for this exam has passed." }, { status: 403 });
  }

  const { count: attemptCount } = await service
    .from("cbt_submissions")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId)
    .eq("student_id", student.id);
  if ((attemptCount || 0) >= Number(exam.attempts_allowed || 1)) {
    return NextResponse.json({ ok: false, error: "You have used all your attempts for this exam." }, { status: 403 });
  }

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + Number(exam.duration_minutes || 15) * 60_000);

  const { data: newSession, error } = await service
    .from("cbt_sessions")
    .insert({ exam_id: examId, student_id: student.id, started_at: startedAt.toISOString(), expires_at: expiresAt.toISOString() })
    .select("id, started_at, expires_at")
    .single();
  if (error || !newSession) {
    // Most likely the unique-open-session index — a session slipped in concurrently (e.g. two tabs).
    return NextResponse.json({ ok: false, error: "You already have this exam open in another tab." }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    sessionId: newSession.id,
    startedAt: newSession.started_at,
    expiresAt: newSession.expires_at,
    secondsLeft: Number(exam.duration_minutes || 15) * 60,
    resumed: false,
    resumable: true,
  });
}
