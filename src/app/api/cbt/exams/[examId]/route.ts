import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { canManageExam } from "@/lib/cbtAuth";

const QUESTION_TYPES = ["multiple_choice", "true_false", "fill_in_the_blank", "short_answer", "essay"];
const GRADING_COMPONENTS = ["test1", "test2", "test3", "exam"];

function validateQuestion(q: any, i: number): string | null {
  if (!String(q?.question_text || "").trim()) return `Question ${i + 1}: text is required.`;
  if (!QUESTION_TYPES.includes(q?.question_type)) return `Question ${i + 1}: invalid question type.`;
  const points = Number(q?.points);
  if (!Number.isFinite(points) || points < 1) return `Question ${i + 1}: points must be at least 1.`;
  if (q.question_type === "essay") return null;
  const answer = String(q?.correct_answer || "").trim();
  if (!answer) return `Question ${i + 1}: a correct answer is required.`;
  if (q.question_type === "multiple_choice") {
    const opts = Array.isArray(q.options) ? q.options.map((o: any) => String(o).trim()).filter(Boolean) : [];
    if (opts.length < 2) return `Question ${i + 1}: at least 2 options are required.`;
    if (new Set(opts.map((o: string) => o.toLowerCase())).size !== opts.length) return `Question ${i + 1}: options must be unique.`;
    if (!opts.some((o: string) => o.toLowerCase() === answer.toLowerCase())) return `Question ${i + 1}: the correct answer must be one of the options.`;
  }
  if (q.question_type === "true_false" && !["true", "false"].includes(answer.toLowerCase())) {
    return `Question ${i + 1}: the correct answer must be True or False.`;
  }
  return null;
}

async function loadExam(service: any, examId: string) {
  const { data } = await service.from("cbt_exams").select("*").eq("id", examId).maybeSingle();
  return data;
}

/** GET — exam settings + its questions (with correct answers, for the builder/teacher view). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  const { examId } = await params;

  const exam = await loadExam(service, examId);
  if (!exam) return NextResponse.json({ ok: false, error: "Exam not found." }, { status: 404 });
  if (!(await canManageExam(actor, exam))) return NextResponse.json({ ok: false, error: "You are not assigned to this exam." }, { status: 403 });

  const { data: questions } = await service.from("cbt_questions").select("*").eq("exam_id", examId).order("position", { ascending: true });
  return NextResponse.json({ ok: true, exam, questions: questions || [] });
}

/** PATCH { title?, description?, duration_minutes?, pass_mark?, attempts_allowed?, due_date?, is_published?, questions?: [...] } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  const { examId } = await params;

  const exam = await loadExam(service, examId);
  if (!exam) return NextResponse.json({ ok: false, error: "Exam not found." }, { status: 404 });
  if (!(await canManageExam(actor, exam))) return NextResponse.json({ ok: false, error: "You are not assigned to this exam." }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { count: submissionCount } = await service.from("cbt_submissions").select("id", { count: "exact", head: true }).eq("exam_id", examId);
  if ((submissionCount || 0) > 0 && Array.isArray(body.questions)) {
    return NextResponse.json(
      { ok: false, error: "This exam already has submissions — questions can no longer be edited. Create a new exam instead." },
      { status: 409 }
    );
  }

  const update: any = {};
  if (body.title !== undefined) update.title = String(body.title).trim();
  if (body.description !== undefined) update.description = body.description ? String(body.description).trim() : null;
  if (body.duration_minutes !== undefined) update.duration_minutes = Math.max(1, Math.min(180, Number(body.duration_minutes) || 15));
  if (body.pass_mark !== undefined) update.pass_mark = Math.max(0, Math.min(100, Number(body.pass_mark) || 50));
  if (body.attempts_allowed !== undefined) update.attempts_allowed = Math.max(1, Math.min(10, Number(body.attempts_allowed) || 1));
  if (body.due_date !== undefined) update.due_date = body.due_date || null;
  if (body.is_published !== undefined) update.is_published = Boolean(body.is_published);
  if (body.grading_component !== undefined) {
    if (!GRADING_COMPONENTS.includes(body.grading_component)) {
      return NextResponse.json({ ok: false, error: "Invalid grading component." }, { status: 400 });
    }
    update.grading_component = body.grading_component;
  }

  if (Array.isArray(body.questions)) {
    if (!body.questions.length) return NextResponse.json({ ok: false, error: "At least one question is required." }, { status: 400 });
    for (let i = 0; i < body.questions.length; i++) {
      const err = validateQuestion(body.questions[i], i);
      if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    }
    const { error: delErr } = await service.from("cbt_questions").delete().eq("exam_id", examId);
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    const { error: qErr } = await service.from("cbt_questions").insert(
      body.questions.map((q: any, i: number) => ({
        exam_id: examId,
        question_text: String(q.question_text).trim(),
        question_type: q.question_type,
        options: q.question_type === "multiple_choice" ? (q.options || []).map((o: any) => String(o).trim()).filter(Boolean) : q.question_type === "true_false" ? ["True", "False"] : [],
        correct_answer: q.question_type === "essay" ? null : String(q.correct_answer).trim(),
        explanation: q.explanation ? String(q.explanation).trim() : null,
        points: Math.max(1, Number(q.points) || 1),
        position: i,
      }))
    );
    if (qErr) return NextResponse.json({ ok: false, error: qErr.message }, { status: 500 });
  }

  if (Object.keys(update).length) {
    const { error } = await service.from("cbt_exams").update(update).eq("id", examId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** DELETE — cascades to its questions, sessions and submissions. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  const { examId } = await params;

  const exam = await loadExam(service, examId);
  if (!exam) return NextResponse.json({ ok: false, error: "Exam not found." }, { status: 404 });
  if (!(await canManageExam(actor, exam))) return NextResponse.json({ ok: false, error: "You are not assigned to this exam." }, { status: 403 });

  const { error } = await service.from("cbt_exams").delete().eq("id", examId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
