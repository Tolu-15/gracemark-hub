import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { canManageExam } from "@/lib/cbtAuth";
import { resolveExamSession, syncCbtScoreToGradebook, CbtGradingComponent } from "@/lib/cbtGradebookSync";

/**
 * POST { examId } — manually (re)syncs every graded submission for a CBT exam
 * into the gradebook. Submit and grade-essay already sync automatically; this
 * is a fallback for admins/teachers if something needs re-running.
 */
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
  const examId = body?.examId;
  if (!examId) return NextResponse.json({ ok: false, error: "examId is required." }, { status: 400 });

  const { data: exam } = await service.from("cbt_exams").select("*").eq("id", examId).maybeSingle();
  if (!exam) return NextResponse.json({ ok: false, error: "Exam not found." }, { status: 404 });
  if (!(await canManageExam(actor, exam))) return NextResponse.json({ ok: false, error: "You are not assigned to this exam." }, { status: 403 });

  const { data: questions } = await service.from("cbt_questions").select("points").eq("exam_id", examId);
  const maxScore = (questions || []).reduce((s: number, q: any) => s + (Number(q.points) || 1), 0);
  if (!maxScore) return NextResponse.json({ ok: false, error: "This exam has no questions yet." }, { status: 400 });

  const { data: submissions, error: subErr } = await service
    .from("cbt_submissions")
    .select("id, student_id, total_score, status")
    .eq("exam_id", examId)
    .eq("status", "graded");
  if (subErr) return NextResponse.json({ ok: false, error: subErr.message }, { status: 500 });
  if (!submissions?.length) return NextResponse.json({ ok: true, message: "No graded submissions to sync yet.", syncedCount: 0 });

  const { sessionName } = await resolveExamSession(service, exam.academic_session_id);
  if (!sessionName) return NextResponse.json({ ok: false, error: "Could not resolve an academic session for this exam." }, { status: 400 });

  let syncedCount = 0;
  const errors: string[] = [];
  for (const sub of submissions) {
    try {
      await syncCbtScoreToGradebook(service, {
        studentId: sub.student_id,
        classId: exam.class_id,
        subjectId: exam.subject_id,
        term: exam.term,
        sessionName,
        academicSessionId: exam.academic_session_id,
        rawScore: Number(sub.total_score || 0),
        maxRawScore: maxScore,
        component: (exam.grading_component as CbtGradingComponent) || "exam",
      });
      syncedCount++;
    } catch (err: any) {
      errors.push(`Student ${sub.student_id}: ${err.message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    message: `Synced ${syncedCount} score(s) to the gradebook.`,
    syncedCount,
    totalSubmissions: submissions.length,
    errors: errors.length ? errors : undefined,
  });
}
