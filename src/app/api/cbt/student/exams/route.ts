import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { resolveStudentRecord } from "@/lib/cbtAuth";

/** GET — published exams for the signed-in student's class, with their own submission status attached. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const student = await resolveStudentRecord(actor);
  if (!student) return NextResponse.json({ ok: false, error: "Student profile not found." }, { status: 404 });

  const { data: exams, error } = await service
    .from("cbt_exams")
    .select("id, title, description, subject_id, term, duration_minutes, pass_mark, attempts_allowed, due_date, is_published, created_at, subjects(name)")
    .eq("class_id", student.class_id)
    .eq("is_published", true)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const examIds = (exams || []).map((e: any) => e.id);
  let questionCounts = new Map<string, number>();
  let submissionsByExam = new Map<string, any[]>();
  let openSessionByExam = new Map<string, any>();

  if (examIds.length) {
    const { data: qCounts } = await service.from("cbt_questions").select("exam_id").in("exam_id", examIds);
    (qCounts || []).forEach((q: any) => questionCounts.set(q.exam_id, (questionCounts.get(q.exam_id) || 0) + 1));

    const { data: subs } = await service
      .from("cbt_submissions")
      .select("id, exam_id, status, total_score, auto_score, passed, submitted_at")
      .eq("student_id", student.id)
      .in("exam_id", examIds);
    (subs || []).forEach((s: any) => {
      const list = submissionsByExam.get(s.exam_id) || [];
      list.push(s);
      submissionsByExam.set(s.exam_id, list);
    });

    const { data: openSessions } = await service
      .from("cbt_sessions")
      .select("exam_id, id, expires_at")
      .eq("student_id", student.id)
      .is("submitted_at", null)
      .in("exam_id", examIds);
    (openSessions || []).forEach((s: any) => openSessionByExam.set(s.exam_id, s));
  }

  const result = (exams || []).map((exam: any) => {
    const submissions = submissionsByExam.get(exam.id) || [];
    const attemptsUsed = submissions.length;
    const bestSubmission = submissions.reduce((best: any, s: any) => (!best || (s.total_score ?? -1) > (best.total_score ?? -1) ? s : best), null);
    const attemptsAllowed = Number(exam.attempts_allowed || 1);
    const openSession = openSessionByExam.get(exam.id);
    return {
      ...exam,
      question_count: questionCounts.get(exam.id) || 0,
      attempts_used: attemptsUsed,
      attempts_remaining: Math.max(0, attemptsAllowed - attemptsUsed),
      can_attempt: attemptsUsed < attemptsAllowed && (!exam.due_date || Date.now() <= new Date(exam.due_date).getTime()),
      has_open_session: Boolean(openSession),
      open_session_id: openSession?.id || null,
      latest_submission: bestSubmission ? { id: bestSubmission.id, status: bestSubmission.status, total_score: bestSubmission.total_score, passed: bestSubmission.passed } : null,
    };
  });

  return NextResponse.json({ ok: true, exams: result });
}
