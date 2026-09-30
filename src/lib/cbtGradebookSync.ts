import { calculateStudentResult, emptyRawScores, normalizeBreakdown, toStoredScores } from "@/lib/gradingEngine";

type Service = any;

/** Resolves the session name + academic_session_id for a cbt_exams row (academic_session_id -> academic_sessions.name). */
export async function resolveExamSession(service: Service, academicSessionId: string | null) {
  if (academicSessionId) {
    const { data } = await service.from("academic_sessions").select("id, name").eq("id", academicSessionId).maybeSingle();
    if (data?.name) return { sessionId: data.id as string, sessionName: data.name as string };
  }
  const { data: active } = await service.from("academic_sessions").select("id, name").eq("status", "active").limit(1).maybeSingle();
  return { sessionId: (active?.id as string) || null, sessionName: (active?.name as string) || "" };
}

const GRADING_COMPONENT_MAX = { test1: 15, test2: 15, test3: 30, exam: 70 } as const;
export type CbtGradingComponent = keyof typeof GRADING_COMPONENT_MAX;

/**
 * Pushes one student's CBT total into their results row for that subject/term —
 * scaled into whichever CA slot the exam is configured to feed (a test slot or
 * the Term Exam). Idempotent: re-running just overwrites the same slot's value.
 */
export async function syncCbtScoreToGradebook(
  service: Service,
  opts: {
    studentId: string;
    classId: string;
    subjectId: string;
    term: string;
    sessionName: string;
    academicSessionId?: string | null;
    rawScore: number;
    maxRawScore: number;
    component: CbtGradingComponent;
  }
): Promise<void> {
  const { studentId, classId, subjectId, term, sessionName, academicSessionId, rawScore, maxRawScore, component } = opts;
  const maxScore = GRADING_COMPONENT_MAX[component];
  const scaledScore = maxRawScore > 0 ? Math.min(maxScore, Math.round((rawScore / maxRawScore) * maxScore)) : 0;

  const { data: existingResult } = await service
    .from("results")
    .select("*")
    .eq("student_id", studentId)
    .eq("subject_id", subjectId)
    .eq("term", term)
    .eq("session", sessionName)
    .maybeSingle();

  const rawBreakdown = existingResult ? normalizeBreakdown(existingResult) : emptyRawScores();
  if (component === "exam") {
    rawBreakdown.exam = String(scaledScore);
  } else if (component === "test1") {
    rawBreakdown.tests[0] = String(scaledScore);
  } else if (component === "test2") {
    rawBreakdown.tests[1] = String(scaledScore);
  } else {
    rawBreakdown.tests[2] = String(scaledScore);
  }

  const calculated = calculateStudentResult(rawBreakdown);
  const stored = toStoredScores(calculated);

  const payload: any = {
    student_id: studentId,
    subject_id: subjectId,
    class_id: classId,
    term,
    session: sessionName,
    ...(academicSessionId ? { academic_session_id: academicSessionId } : {}),
    score_breakdown: rawBreakdown,
    cw: stored.cw,
    hw: stored.hw,
    test: stored.test,
    project: stored.project,
    exam: stored.exam,
    grade: stored.grade,
    status: existingResult?.status || "draft",
    updated_at: new Date().toISOString(),
  };
  if (existingResult?.id) payload.id = existingResult.id;

  const { error } = await service.from("results").upsert(payload, { onConflict: "student_id,subject_id,term,session" });
  if (error) throw error;
}
