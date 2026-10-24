import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireTeacherAssignment } from "@/lib/apiAuth";

const QUESTION_TYPES = ["multiple_choice", "true_false", "fill_in_the_blank", "short_answer", "essay"];
const GRADING_COMPONENTS = ["test1", "test2", "test3", "exam"];

function validateQuestion(q: any, i: number): string | null {
  if (!String(q?.question_text || "").trim()) return `Question ${i + 1}: text is required.`;
  if (!QUESTION_TYPES.includes(q?.question_type)) return `Question ${i + 1}: invalid question type.`;
  const points = Number(q?.points);
  if (!Number.isFinite(points) || points < 1) return `Question ${i + 1}: points must be at least 1.`;
  if (q.question_type === "essay") return null; // manually graded, no correct_answer required
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

/** GET ?class_id=&subject_id= — list exams. Admins see everything; teachers only what they created or are assigned to teach. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  const sp = req.nextUrl.searchParams;
  const classId = sp.get("class_id");
  const subjectId = sp.get("subject_id");

  let query = service
    .from("cbt_exams")
    .select("id, title, description, class_id, subject_id, term, academic_session_id, duration_minutes, pass_mark, attempts_allowed, due_date, grading_component, is_published, created_by, created_at, classes(name), subjects(name)")
    .order("created_at", { ascending: false });
  if (classId) query = query.eq("class_id", classId);
  if (subjectId) query = query.eq("subject_id", subjectId);
  if (actor.role === "teacher" && actor.dbUserId) query = query.eq("created_by", actor.dbUserId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const examIds = (data || []).map((e: any) => e.id);
  let counts = new Map<string, number>();
  if (examIds.length) {
    const { data: qCounts } = await service.from("cbt_questions").select("exam_id").in("exam_id", examIds);
    (qCounts || []).forEach((q: any) => counts.set(q.exam_id, (counts.get(q.exam_id) || 0) + 1));
    const { data: sCounts } = await service.from("cbt_submissions").select("exam_id").in("exam_id", examIds);
    const subCounts = new Map<string, number>();
    (sCounts || []).forEach((s: any) => subCounts.set(s.exam_id, (subCounts.get(s.exam_id) || 0) + 1));
    return NextResponse.json({
      ok: true,
      exams: (data || []).map((e: any) => ({ ...e, question_count: counts.get(e.id) || 0, submission_count: subCounts.get(e.id) || 0 })),
    });
  }

  return NextResponse.json({ ok: true, exams: data || [] });
}

/** POST { class_id, subject_id, term, academic_session_id?, title, description?, duration_minutes, pass_mark, attempts_allowed, due_date?, is_published, questions: [...] } */
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

  const { class_id, subject_id, term, title } = body || {};
  if (!class_id || !subject_id || !term || !String(title || "").trim()) {
    return NextResponse.json({ ok: false, error: "class_id, subject_id, term and title are required." }, { status: 400 });
  }
  const gradingComponent = body.grading_component || "exam";
  if (!GRADING_COMPONENTS.includes(gradingComponent)) {
    return NextResponse.json({ ok: false, error: "Invalid grading component." }, { status: 400 });
  }
  if (actor.role === "teacher" && !(await requireTeacherAssignment(actor, class_id, subject_id, body.academic_session_id))) {
    return NextResponse.json({ ok: false, error: "You are not assigned to this class and subject." }, { status: 403 });
  }

  const questions: any[] = Array.isArray(body.questions) ? body.questions : [];
  if (!questions.length) {
    return NextResponse.json({ ok: false, error: "At least one question is required." }, { status: 400 });
  }
  for (let i = 0; i < questions.length; i++) {
    const err = validateQuestion(questions[i], i);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }

  let academicSessionId = body.academic_session_id || null;
  if (!academicSessionId) {
    const { data: active } = await service.from("academic_sessions").select("id").eq("status", "active").limit(1).maybeSingle();
    academicSessionId = active?.id || null;
  }
  if (!academicSessionId) {
    return NextResponse.json({ ok: false, error: "No active academic session is set." }, { status: 400 });
  }

  const { data: exam, error: examErr } = await service
    .from("cbt_exams")
    .insert({
      class_id,
      subject_id,
      term,
      academic_session_id: academicSessionId,
      created_by: actor.dbUserId,
      title: String(title).trim(),
      description: body.description ? String(body.description).trim() : null,
      duration_minutes: Math.max(1, Math.min(180, Number(body.duration_minutes) || 15)),
      pass_mark: Math.max(0, Math.min(100, Number(body.pass_mark) || 50)),
      attempts_allowed: Math.max(1, Math.min(10, Number(body.attempts_allowed) || 1)),
      due_date: body.due_date || null,
      grading_component: gradingComponent,
      is_published: false,
    })
    .select("id")
    .single();
  if (examErr || !exam) return NextResponse.json({ ok: false, error: examErr?.message || "Could not create the exam." }, { status: 500 });

  const { error: qErr } = await service.from("cbt_questions").insert(
    questions.map((q, i) => ({
      exam_id: exam.id,
      question_text: String(q.question_text).trim(),
      question_type: q.question_type,
      options: q.question_type === "multiple_choice" ? (q.options || []).map((o: any) => String(o).trim()).filter(Boolean) : q.question_type === "true_false" ? ["True", "False"] : [],
      correct_answer: q.question_type === "essay" ? null : String(q.correct_answer).trim(),
      explanation: q.explanation ? String(q.explanation).trim() : null,
      points: Math.max(1, Number(q.points) || 1),
      position: i,
    }))
  );
  if (qErr) {
    await service.from("cbt_exams").delete().eq("id", exam.id);
    return NextResponse.json({ ok: false, error: qErr.message }, { status: 500 });
  }

  if (body.is_published) {
    await service.from("cbt_exams").update({ is_published: true }).eq("id", exam.id);
  }

  return NextResponse.json({ ok: true, examId: exam.id });
}
