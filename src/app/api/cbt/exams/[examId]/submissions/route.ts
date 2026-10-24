import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { canManageExam } from "@/lib/cbtAuth";

/** GET — every submission for an exam (for the teacher's grading/results view). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  const { examId } = await params;

  const { data: exam } = await service.from("cbt_exams").select("*").eq("id", examId).maybeSingle();
  if (!exam) return NextResponse.json({ ok: false, error: "Exam not found." }, { status: 404 });
  if (!(await canManageExam(actor, exam))) return NextResponse.json({ ok: false, error: "You are not assigned to this exam." }, { status: 403 });

  const { data: submissions, error } = await service
    .from("cbt_submissions")
    .select("id, student_id, auto_score, manual_score, total_score, passed, status, tab_switches, integrity_flags, submitted_at, graded_at, students(name, admission_no)")
    .eq("exam_id", examId)
    .order("submitted_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const { data: questions } = await service.from("cbt_questions").select("id, points, question_type").eq("exam_id", examId);
  const maxScore = (questions || []).reduce((sum: number, q: any) => sum + (Number(q.points) || 1), 0);
  const hasEssay = (questions || []).some((q: any) => q.question_type === "essay");

  return NextResponse.json({ ok: true, submissions: submissions || [], maxScore, hasEssay });
}
