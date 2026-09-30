import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { resolveStudentRecord, canManageExam } from "@/lib/cbtAuth";
import { answerMatches } from "@/lib/cbtScoring";

/** GET ?submissionId= — full question+answer-key review for a submitted attempt. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student", "admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  const submissionId = req.nextUrl.searchParams.get("submissionId");
  if (!submissionId) return NextResponse.json({ ok: false, error: "submissionId is required." }, { status: 400 });

  const { data: submission } = await service.from("cbt_submissions").select("*").eq("id", submissionId).maybeSingle();
  if (!submission) return NextResponse.json({ ok: false, error: "Submission not found." }, { status: 404 });

  const { data: exam } = await service.from("cbt_exams").select("*").eq("id", submission.exam_id).maybeSingle();
  if (!exam) return NextResponse.json({ ok: false, error: "Exam not found." }, { status: 404 });

  if (actor.role === "student") {
    const student = await resolveStudentRecord(actor);
    if (!student || student.id !== submission.student_id) {
      return NextResponse.json({ ok: false, error: "Not your submission." }, { status: 403 });
    }
  } else if (!(await canManageExam(actor, exam))) {
    return NextResponse.json({ ok: false, error: "You are not assigned to this exam." }, { status: 403 });
  }

  const { data: questions } = await service.from("cbt_questions").select("*").eq("exam_id", exam.id).order("position", { ascending: true });
  const answers = (submission.answers || {}) as Record<string, string>;

  const questionReview = (questions || []).map((q: any) => {
    const studentAnswer = answers[q.id] ?? "";
    const isEssay = q.question_type === "essay";
    const correct = isEssay ? null : answerMatches(studentAnswer, q.correct_answer, Array.isArray(q.options) ? q.options : []);
    return {
      id: q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      options: q.options,
      points: q.points,
      explanation: q.explanation,
      correct_answer: q.correct_answer,
      student_answer: studentAnswer,
      correct,
    };
  });

  return NextResponse.json({
    ok: true,
    exam: { id: exam.id, title: exam.title, pass_mark: exam.pass_mark },
    submission: {
      id: submission.id,
      status: submission.status,
      auto_score: submission.auto_score,
      manual_score: submission.manual_score,
      total_score: submission.total_score,
      passed: submission.passed,
      tab_switches: submission.tab_switches,
      integrity_flags: submission.integrity_flags,
      submitted_at: submission.submitted_at,
      graded_at: submission.graded_at,
    },
    questions: questionReview,
  });
}
