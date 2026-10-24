import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { canManageExam } from "@/lib/cbtAuth";
import { resolveExamSession, syncCbtScoreToGradebook, CbtGradingComponent } from "@/lib/cbtGradebookSync";

/** POST { submissionId, scores: { [questionId]: number } } — teacher/admin manual score for essay questions. */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const submissionId = body?.submissionId;
  const scores: Record<string, number> = body?.scores && typeof body.scores === "object" ? body.scores : {};
  if (!submissionId) return NextResponse.json({ ok: false, error: "submissionId is required." }, { status: 400 });

  const { data: submission } = await service.from("cbt_submissions").select("*").eq("id", submissionId).maybeSingle();
  if (!submission) return NextResponse.json({ ok: false, error: "Submission not found." }, { status: 404 });

  const { data: exam } = await service.from("cbt_exams").select("*").eq("id", submission.exam_id).maybeSingle();
  if (!exam) return NextResponse.json({ ok: false, error: "Exam not found." }, { status: 404 });
  if (!(await canManageExam(actor, exam))) return NextResponse.json({ ok: false, error: "You are not assigned to this exam." }, { status: 403 });

  const { data: questions } = await service.from("cbt_questions").select("id, points, question_type").eq("exam_id", exam.id);
  const essayQuestions = (questions || []).filter((q: any) => q.question_type === "essay");
  const maxScore = (questions || []).reduce((s: number, q: any) => s + (Number(q.points) || 1), 0);

  let manualScore = 0;
  for (const q of essayQuestions) {
    const raw = Number(scores[q.id]);
    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(Number(q.points) || 1, raw)) : 0;
    manualScore += clamped;
  }

  const totalScore = Number(submission.auto_score || 0) + manualScore;
  const passed = maxScore > 0 ? (totalScore / maxScore) * 100 >= Number(exam.pass_mark || 50) : false;

  const { error } = await service
    .from("cbt_submissions")
    .update({
      manual_score: manualScore,
      // total_score is a generated column (auto_score + manual_score) —
      // never written directly, the database recomputes it from manual_score.
      passed,
      status: "graded",
      graded_by: actor.dbUserId,
      graded_at: new Date().toISOString(),
    })
    .eq("id", submissionId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const { sessionName } = await resolveExamSession(service, exam.academic_session_id);
  if (sessionName) {
    await syncCbtScoreToGradebook(service, {
      studentId: submission.student_id,
      classId: exam.class_id,
      subjectId: exam.subject_id,
      term: exam.term,
      sessionName,
      academicSessionId: exam.academic_session_id,
      rawScore: totalScore,
      maxRawScore: maxScore,
      component: (exam.grading_component as CbtGradingComponent) || "exam",
    });
  }

  return NextResponse.json({ ok: true, totalScore, maxScore, passed });
}
