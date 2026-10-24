import { scoreObjectiveAnswers } from "@/lib/cbtScoring";
import { resolveExamSession, syncCbtScoreToGradebook, CbtGradingComponent } from "@/lib/cbtGradebookSync";
import { ensureEnrollments } from "@/lib/reportBuilder";

type Service = any;

interface FinalizeArgs {
  service: Service;
  exam: { id: string; class_id: string; subject_id: string; term: string; academic_session_id: string | null; pass_mark: number; grading_component?: string };
  session: { id: string; started_at: string };
  studentId: string;
  answers: Record<string, string>;
  tabSwitches: number;
  /** Session ran out (+ grace) — score is forced to 0 regardless of answers. */
  forceZero: boolean;
  integrityFlags: string[];
}

/**
 * Scores a submission, writes it, closes the session, and — if nothing in it
 * needs manual (essay) grading — immediately syncs the score into the
 * gradebook. Shared between the real submit route and the abandoned-session
 * reaper in the start route, same as QuizHub's shared score_objective().
 */
export async function finalizeSubmission({ service, exam, session, studentId, answers, tabSwitches, forceZero, integrityFlags }: FinalizeArgs) {
  const { data: questions } = await service.from("cbt_questions").select("*").eq("exam_id", exam.id).order("position", { ascending: true });
  const qList = questions || [];

  const timeTaken = Math.max(0, Math.min(86400, Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000)));

  let autoScore = 0;
  let maxScore = 0;
  let hasManualQuestions = false;
  if (forceZero) {
    maxScore = qList.reduce((s: number, q: any) => s + (Number(q.points) || 1), 0);
    hasManualQuestions = qList.some((q: any) => q.question_type === "essay");
  } else {
    const scored = scoreObjectiveAnswers(qList, answers);
    autoScore = scored.autoScore;
    maxScore = scored.maxScore;
    hasManualQuestions = scored.hasManualQuestions;
  }

  const status = hasManualQuestions ? "submitted" : "graded";
  const totalScore = hasManualQuestions ? null : autoScore;
  const percentage = totalScore !== null && maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
  const passed = !hasManualQuestions && percentage >= Number(exam.pass_mark || 50);

  const { sessionId: academicSessionId, sessionName } = await resolveExamSession(service, exam.academic_session_id);
  let enrollmentId: string | null = null;
  if (academicSessionId) {
    await ensureEnrollments(service, exam.class_id, academicSessionId, [studentId]);
    const { data: enrollment } = await service
      .from("student_enrollments")
      .select("id")
      .eq("academic_session_id", academicSessionId)
      .eq("student_id", studentId)
      .maybeSingle();
    enrollmentId = enrollment?.id || null;
  }

  const { data: submission, error } = await service
    .from("cbt_submissions")
    .insert({
      exam_id: exam.id,
      student_id: studentId,
      enrollment_id: enrollmentId,
      auto_score: autoScore,
      manual_score: 0,
      // total_score is a generated column (auto_score + manual_score) — the
      // database computes it; a value must never be written here, or every
      // insert is rejected with "cannot insert a non-DEFAULT value".
      passed,
      status,
      answers,
      tab_switches: Math.max(0, Math.min(10, tabSwitches)),
      time_taken_secs: timeTaken,
      integrity_flags: integrityFlags,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !submission) throw new Error(error?.message || "Could not save the submission.");

  await service.from("cbt_sessions").update({ submitted_at: new Date().toISOString(), submission_id: submission.id }).eq("id", session.id);

  if (!hasManualQuestions && sessionName) {
    await syncCbtScoreToGradebook(service, {
      studentId,
      classId: exam.class_id,
      subjectId: exam.subject_id,
      term: exam.term,
      sessionName,
      academicSessionId: exam.academic_session_id,
      rawScore: autoScore,
      maxRawScore: maxScore,
      component: (exam.grading_component as CbtGradingComponent) || "exam",
    });
  }

  return { submissionId: submission.id, autoScore, maxScore, totalScore, passed, hasManualQuestions, status };
}
