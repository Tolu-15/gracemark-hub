"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";

type QuestionType = "multiple_choice" | "true_false" | "fill_in_the_blank" | "short_answer" | "essay";
type GradingComponent = "test1" | "test2" | "test3" | "exam";

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / False",
  fill_in_the_blank: "Fill in the blank",
  short_answer: "Short answer",
  essay: "Essay (graded manually)",
};

const GRADING_COMPONENT_LABELS: Record<GradingComponent, string> = {
  test1: "Test 1 (15 pts)",
  test2: "Test 2 (15 pts)",
  test3: "Test 3 (30 pts)",
  exam: "Term Exam (70 pts)",
};

interface QuestionDraft {
  id: string;
  question_text: string;
  question_type: QuestionType;
  options: string[];
  correct_answer: string;
  explanation: string;
  points: number;
}

interface ExamListItem {
  id: string;
  title: string;
  class_id: string;
  subject_id: string;
  term: string;
  is_published: boolean;
  duration_minutes: number;
  pass_mark: number;
  attempts_allowed: number;
  due_date: string | null;
  grading_component: GradingComponent;
  question_count: number;
  submission_count: number;
  classes?: { name: string };
  subjects?: { name: string };
}

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

function newQuestion(): QuestionDraft {
  return {
    id: `new_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    question_text: "",
    question_type: "multiple_choice",
    options: ["", "", "", ""],
    correct_answer: "",
    explanation: "",
    points: 1,
  };
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(await getAuthHeaders()), ...(init?.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

export default function ExamManager({ role }: { role: "admin" | "teacher" }) {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [subjectsByClass, setSubjectsByClass] = useState<Map<string, { id: string; name: string }[]>>(new Map());
  const [allSubjects, setAllSubjects] = useState<{ id: string; name: string }[]>([]);
  const [term, setTerm] = useState("term1");

  const [view, setView] = useState<"list" | "editor" | "submissions">("list");
  const [exams, setExams] = useState<ExamListItem[]>([]);
  const [loadingExams, setLoadingExams] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // Editor state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    class_id: "",
    subject_id: "",
    title: "",
    description: "",
    duration_minutes: 15,
    pass_mark: 50,
    attempts_allowed: 1,
    due_date: "",
    grading_component: "exam" as GradingComponent,
    is_published: false,
  });
  const [questions, setQuestions] = useState<QuestionDraft[]>([newQuestion()]);
  const [locked, setLocked] = useState(false); // has submissions -> questions can't change
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Submissions/grading state
  const [subExamId, setSubExamId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [subMaxScore, setSubMaxScore] = useState(0);
  const [subHasEssay, setSubHasEssay] = useState(false);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [gradingReview, setGradingReview] = useState<any | null>(null);
  const [essayScores, setEssayScores] = useState<Record<string, number>>({});

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  };

  const loadClassesAndSubjects = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return;
    const { data: allSub } = await supabase.from("subjects").select("id, name").order("name");
    setAllSubjects(allSub || []);

    if (role === "admin") {
      const { data: allCl } = await supabase.from("classes").select("id, name").order("display_order");
      setClasses(allCl || []);
      const map = new Map<string, { id: string; name: string }[]>();
      (allCl || []).forEach((c: any) => map.set(c.id, allSub || []));
      setSubjectsByClass(map);
      return;
    }

    const { data: profile } = await supabase.from("users").select("id").eq("auth_id", user.id).maybeSingle();
    const idList = Array.from(new Set([user.id, profile?.id].filter(Boolean)));
    const { data: sta } = await supabase
      .from("subject_teacher_assignments")
      .select("class_id, subject_id, classes(id, name), subjects(id, name)")
      .in("teacher_user_id", idList)
      .eq("status", "active");

    const classMap = new Map<string, { id: string; name: string }>();
    const map = new Map<string, { id: string; name: string }[]>();
    (sta || []).forEach((a: any) => {
      if (!a.classes?.id || !a.subjects?.id) return;
      classMap.set(a.classes.id, a.classes);
      const list = map.get(a.classes.id) || [];
      if (!list.some((s) => s.id === a.subjects.id)) list.push(a.subjects);
      map.set(a.classes.id, list);
    });
    setClasses(Array.from(classMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
    setSubjectsByClass(map);
  }, [role]);

  const loadExams = useCallback(async () => {
    setLoadingExams(true);
    try {
      const { res, json } = await api("/api/cbt/exams");
      if (res.ok && json.ok) setExams(json.exams || []);
    } finally {
      setLoadingExams(false);
    }
  }, []);

  useEffect(() => {
    loadClassesAndSubjects();
    loadExams();
    fetch("/api/terms")
      .then((r) => r.json())
      .then((d) => d?.current_term && setTerm(d.current_term))
      .catch(() => {});
  }, [loadClassesAndSubjects, loadExams]);

  const availableSubjects = useMemo(() => subjectsByClass.get(form.class_id) || [], [subjectsByClass, form.class_id]);

  function startNewExam() {
    setEditingId(null);
    setForm({
      class_id: classes[0]?.id || "",
      subject_id: "",
      title: "",
      description: "",
      duration_minutes: 15,
      pass_mark: 50,
      attempts_allowed: 1,
      due_date: "",
      grading_component: "exam" as GradingComponent,
      is_published: false,
    });
    setQuestions([newQuestion()]);
    setLocked(false);
    setView("editor");
  }

  async function startEditExam(id: string) {
    const { res, json } = await api(`/api/cbt/exams/${id}`);
    if (!res.ok || !json.ok) {
      flash(json.error || "Could not load the exam.");
      return;
    }
    const exam = json.exam;
    setEditingId(id);
    setForm({
      class_id: exam.class_id,
      subject_id: exam.subject_id,
      title: exam.title,
      description: exam.description || "",
      duration_minutes: exam.duration_minutes,
      pass_mark: exam.pass_mark,
      attempts_allowed: exam.attempts_allowed,
      due_date: exam.due_date ? String(exam.due_date).slice(0, 16) : "",
      grading_component: (exam.grading_component as GradingComponent) || "exam",
      is_published: exam.is_published,
    });
    setQuestions(
      (json.questions || []).map((q: any) => ({
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        options: q.question_type === "multiple_choice" ? [...(q.options || []), "", "", "", ""].slice(0, Math.max(4, (q.options || []).length)) : ["", "", "", ""],
        correct_answer: q.correct_answer || "",
        explanation: q.explanation || "",
        points: q.points,
      }))
    );
    setLocked((exams.find((e) => e.id === id)?.submission_count || 0) > 0);
    setView("editor");
  }

  function updateQuestion(id: string, patch: Partial<QuestionDraft>) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function removeQuestion(id: string) {
    setQuestions((prev) => (prev.length > 1 ? prev.filter((q) => q.id !== id) : prev));
  }

  function validateForm(): string | null {
    if (!form.class_id || !form.subject_id) return "Select a class and subject.";
    if (!form.title.trim()) return "Title is required.";
    if (!questions.length) return "Add at least one question.";
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question_text.trim()) return `Question ${i + 1}: text is required.`;
      if (q.question_type === "essay") continue;
      if (!q.correct_answer.trim()) return `Question ${i + 1}: a correct answer is required.`;
      if (q.question_type === "multiple_choice") {
        const opts = q.options.map((o) => o.trim()).filter(Boolean);
        if (opts.length < 2) return `Question ${i + 1}: at least 2 options are required.`;
        if (!opts.some((o) => o.toLowerCase() === q.correct_answer.trim().toLowerCase())) return `Question ${i + 1}: the correct answer must be one of the options.`;
      }
      if (q.question_type === "true_false" && !["true", "false"].includes(q.correct_answer.trim().toLowerCase())) {
        return `Question ${i + 1}: the correct answer must be True or False.`;
      }
    }
    return null;
  }

  async function handleSaveExam(publish: boolean) {
    const err = validateForm();
    if (err) {
      flash(err);
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        class_id: form.class_id,
        subject_id: form.subject_id,
        term,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        duration_minutes: form.duration_minutes,
        pass_mark: form.pass_mark,
        attempts_allowed: form.attempts_allowed,
        due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
        grading_component: form.grading_component,
        is_published: publish,
      };
      if (!locked) {
        payload.questions = questions.map((q) => ({
          question_text: q.question_text.trim(),
          question_type: q.question_type,
          options: q.question_type === "multiple_choice" ? q.options.filter((o) => o.trim()) : q.question_type === "true_false" ? ["True", "False"] : [],
          correct_answer: q.question_type === "essay" ? "" : q.correct_answer.trim(),
          explanation: q.explanation.trim() || undefined,
          points: q.points,
        }));
      }

      const { res, json } = editingId
        ? await api(`/api/cbt/exams/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api("/api/cbt/exams", { method: "POST", body: JSON.stringify(payload) });

      if (!res.ok || !json.ok) throw new Error(json.error || "Could not save the exam.");
      flash(publish ? "Exam saved and published!" : "Exam saved as draft.");
      setView("list");
      loadExams();
    } catch (e: any) {
      flash(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteExam(id: string) {
    if (!window.confirm("Delete this exam? Any submissions will be lost too.")) return;
    const { res, json } = await api(`/api/cbt/exams/${id}`, { method: "DELETE" });
    if (!res.ok || !json.ok) {
      flash(json.error || "Could not delete the exam.");
      return;
    }
    flash("Exam deleted.");
    loadExams();
  }

  async function handleTogglePublish(exam: ExamListItem) {
    const { res, json } = await api(`/api/cbt/exams/${exam.id}`, { method: "PATCH", body: JSON.stringify({ is_published: !exam.is_published }) });
    if (!res.ok || !json.ok) {
      flash(json.error || "Could not update the exam.");
      return;
    }
    loadExams();
  }

  async function openSubmissions(examId: string) {
    setSubExamId(examId);
    setView("submissions");
    setGradingId(null);
    const { res, json } = await api(`/api/cbt/exams/${examId}/submissions`);
    if (res.ok && json.ok) {
      setSubmissions(json.submissions || []);
      setSubMaxScore(json.maxScore || 0);
      setSubHasEssay(Boolean(json.hasEssay));
    }
  }

  async function openGrading(submissionId: string) {
    setGradingId(submissionId);
    const { res, json } = await api(`/api/cbt/attempt/review?submissionId=${submissionId}`);
    if (res.ok && json.ok) {
      setGradingReview(json);
      const initial: Record<string, number> = {};
      json.questions.filter((q: any) => q.question_type === "essay").forEach((q: any) => (initial[q.id] = 0));
      setEssayScores(initial);
    }
  }

  async function submitEssayGrades() {
    if (!gradingId) return;
    const { res, json } = await api("/api/cbt/attempt/grade-essay", { method: "POST", body: JSON.stringify({ submissionId: gradingId, scores: essayScores }) });
    if (!res.ok || !json.ok) {
      flash(json.error || "Could not save the grade.");
      return;
    }
    flash("Grade saved!");
    setGradingId(null);
    if (subExamId) openSubmissions(subExamId);
  }

  async function handleExcelImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames.find((n) => n.toLowerCase().includes("question")) || wb.SheetNames[wb.SheetNames.length - 1];
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      const imported: QuestionDraft[] = [];
      const errors: string[] = [];
      rows.forEach((row, i) => {
        const rowNum = i + 2;
        const type = String(row.question_type || "").trim().toLowerCase();
        const text = String(row.question_text || "").trim();
        const answer = String(row.correct_answer || "").trim();
        if (!text) return; // skip blank rows
        if (!["multiple_choice", "mcq", "true_false"].includes(type)) {
          errors.push(`Row ${rowNum}: question_type must be multiple_choice or true_false.`);
          return;
        }
        if (!answer) {
          errors.push(`Row ${rowNum}: correct_answer is required.`);
          return;
        }
        const questionType: QuestionType = type === "true_false" ? "true_false" : "multiple_choice";
        const options =
          questionType === "true_false"
            ? ["True", "False"]
            : [row.option_a, row.option_b, row.option_c, row.option_d].map((v) => String(v ?? "").trim()).filter(Boolean);
        if (questionType === "multiple_choice" && options.length < 2) {
          errors.push(`Row ${rowNum}: at least 2 options are required.`);
          return;
        }
        imported.push({
          id: `import_${i}_${Date.now()}`,
          question_text: text,
          question_type: questionType,
          options: [...options, "", "", "", ""].slice(0, Math.max(4, options.length)),
          correct_answer: answer,
          explanation: String(row.explanation || "").trim(),
          points: Number(row.points) || 1,
        });
      });
      if (imported.length) {
        setQuestions((prev) => {
          const blank = prev.filter((q) => !q.question_text.trim());
          const kept = prev.filter((q) => q.question_text.trim());
          return [...kept, ...imported];
        });
      }
      flash(`Imported ${imported.length} question(s)${errors.length ? `, ${errors.length} row(s) skipped` : ""}.`);
      if (errors.length) console.warn("Excel import errors:", errors);
    } catch (err: any) {
      flash(`Could not read that file: ${err.message}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      { question_text: "The capital of Nigeria is?", question_type: "multiple_choice", option_a: "Lagos", option_b: "Abuja", option_c: "Kano", option_d: "Ibadan", correct_answer: "Abuja", points: 1 },
      { question_text: "The sun rises in the east.", question_type: "true_false", option_a: "", option_b: "", option_c: "", option_d: "", correct_answer: "True", points: 1 },
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Questions");
    XLSX.writeFile(wb, "CBT_Question_Import_Template.xlsx");
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">CBT Exams</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Timed, auto-graded online exams — students take these under a real countdown with tab-switch and copy/paste detection.
          </p>
        </div>
        {view === "list" && (
          <button type="button" onClick={startNewExam} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs shadow-xs cursor-pointer">
            + New Exam
          </button>
        )}
        {view !== "list" && (
          <button type="button" onClick={() => setView("list")} className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
            ← Back to list
          </button>
        )}
      </div>

      {toast && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">{toast}</div>}

      {view === "list" && (
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Title</th>
                  <th className="px-2 py-2.5">Class / Subject</th>
                  <th className="px-2 py-2.5">Counts toward</th>
                  <th className="px-2 py-2.5 text-center">Questions</th>
                  <th className="px-2 py-2.5 text-center">Submissions</th>
                  <th className="px-2 py-2.5 text-center">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingExams ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : exams.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                      No exams yet. Click &ldquo;+ New Exam&rdquo; to create one.
                    </td>
                  </tr>
                ) : (
                  exams.map((exam) => (
                    <tr key={exam.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{exam.title}</td>
                      <td className="px-2 py-2.5 text-slate-600">
                        {exam.classes?.name || "—"} · {exam.subjects?.name || "—"}
                      </td>
                      <td className="px-2 py-2.5 text-slate-600">{GRADING_COMPONENT_LABELS[exam.grading_component] || "Term Exam (70 pts)"}</td>
                      <td className="px-2 py-2.5 text-center">{exam.question_count}</td>
                      <td className="px-2 py-2.5 text-center">
                        <button type="button" onClick={() => openSubmissions(exam.id)} className="text-blue-600 hover:underline cursor-pointer font-semibold">
                          {exam.submission_count}
                        </button>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleTogglePublish(exam)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase cursor-pointer ${exam.is_published ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500"}`}
                        >
                          {exam.is_published ? "Published" : "Draft"}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button type="button" onClick={() => startEditExam(exam.id)} className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer">
                          Edit
                        </button>
                        <button type="button" onClick={() => handleDeleteExam(exam.id)} className="px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 rounded-md cursor-pointer">
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "editor" && (
        <div className="space-y-4">
          {locked && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
              This exam already has submissions — settings can be updated, but questions are locked to keep past scores fair.
            </div>
          )}

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Class</label>
                <select
                  value={form.class_id}
                  disabled={!!editingId}
                  onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value, subject_id: "" }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold disabled:opacity-60"
                >
                  <option value="">Select class…</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Subject</label>
                <select
                  value={form.subject_id}
                  disabled={!!editingId}
                  onChange={(e) => setForm((f) => ({ ...f, subject_id: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold disabled:opacity-60"
                >
                  <option value="">Select subject…</option>
                  {availableSubjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Mid-Term Test"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Description (optional)</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Time limit (min)</label>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={form.duration_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, duration_minutes: Number(e.target.value) }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Pass mark (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.pass_mark}
                  onChange={(e) => setForm((f) => ({ ...f, pass_mark: Number(e.target.value) }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Attempts allowed</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={form.attempts_allowed}
                  onChange={(e) => setForm((f) => ({ ...f, attempts_allowed: Number(e.target.value) }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Due date (optional)</label>
                <input
                  type="datetime-local"
                  value={form.due_date}
                  onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Counts toward</label>
              <select
                value={form.grading_component}
                onChange={(e) => setForm((f) => ({ ...f, grading_component: e.target.value as GradingComponent }))}
                className="w-full sm:w-64 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
              >
                {(Object.keys(GRADING_COMPONENT_LABELS) as GradingComponent[]).map((c) => (
                  <option key={c} value={c}>
                    {GRADING_COMPONENT_LABELS[c]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                Once every submission is graded, the score is scaled into this slot on the student&apos;s report card for {form.subject_id ? "this subject" : "the selected subject"}.
              </p>
            </div>
          </div>

          {!locked && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-900">Questions ({questions.length})</h3>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={downloadTemplate} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer underline">
                    Download Excel template
                  </button>
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                    Import from Excel
                  </button>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelImport} />
                </div>
              </div>

              <div className="space-y-4">
                {questions.map((q, i) => (
                  <div key={q.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-500">Question {i + 1}</span>
                      <button type="button" onClick={() => removeQuestion(q.id)} disabled={questions.length === 1} className="text-[11px] font-semibold text-rose-600 hover:underline disabled:opacity-30 cursor-pointer">
                        Remove
                      </button>
                    </div>
                    <textarea
                      value={q.question_text}
                      onChange={(e) => updateQuestion(q.id, { question_text: e.target.value })}
                      placeholder="Question text"
                      rows={2}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <select
                        value={q.question_type}
                        onChange={(e) => updateQuestion(q.id, { question_type: e.target.value as QuestionType, correct_answer: "" })}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold"
                      >
                        {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
                          <option key={t} value={t}>
                            {QUESTION_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={q.points}
                        onChange={(e) => updateQuestion(q.id, { points: Number(e.target.value) })}
                        placeholder="Points"
                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                    </div>

                    {q.question_type === "multiple_choice" && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {q.options.map((opt, oi) => (
                          <input
                            key={oi}
                            type="text"
                            value={opt}
                            onChange={(e) => {
                              const next = [...q.options];
                              next[oi] = e.target.value;
                              updateQuestion(q.id, { options: next });
                            }}
                            placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                          />
                        ))}
                      </div>
                    )}

                    {q.question_type !== "essay" && (
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Correct answer</label>
                        {q.question_type === "true_false" ? (
                          <select
                            value={q.correct_answer}
                            onChange={(e) => updateQuestion(q.id, { correct_answer: e.target.value })}
                            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold"
                          >
                            <option value="">Select…</option>
                            <option value="True">True</option>
                            <option value="False">False</option>
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={q.correct_answer}
                            onChange={(e) => updateQuestion(q.id, { correct_answer: e.target.value })}
                            placeholder={q.question_type === "multiple_choice" ? "Must match one option exactly" : "Expected answer"}
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                          />
                        )}
                      </div>
                    )}

                    <input
                      type="text"
                      value={q.explanation}
                      onChange={(e) => updateQuestion(q.id, { explanation: e.target.value })}
                      placeholder="Explanation shown after grading (optional)"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setQuestions((prev) => [...prev, newQuestion()])}
                className="w-full py-2 border-2 border-dashed border-slate-300 rounded-xl text-xs font-bold text-slate-500 hover:border-slate-400 hover:text-slate-700 cursor-pointer"
              >
                + Add question
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => handleSaveExam(false)} className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold rounded-xl text-xs cursor-pointer disabled:opacity-50">
              Save as draft
            </button>
            <button type="button" disabled={saving} onClick={() => handleSaveExam(true)} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer disabled:opacity-50">
              {saving ? "Saving…" : "Save & Publish"}
            </button>
          </div>
        </div>
      )}

      {view === "submissions" && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Student</th>
                    <th className="px-2 py-2.5 text-center">Score</th>
                    <th className="px-2 py-2.5 text-center">Status</th>
                    <th className="px-2 py-2.5 text-center">Tab switches</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {submissions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-slate-400">
                        No submissions yet.
                      </td>
                    </tr>
                  ) : (
                    submissions.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-semibold text-slate-900">{s.students?.name || "Student"}</td>
                        <td className="px-2 py-2.5 text-center font-bold">
                          {s.total_score !== null ? `${s.total_score}/${subMaxScore}` : "Pending"}
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${s.status === "graded" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{s.status}</span>
                        </td>
                        <td className="px-2 py-2.5 text-center">{s.tab_switches > 0 ? <span className="text-rose-600 font-semibold">{s.tab_switches}</span> : "—"}</td>
                        <td className="px-4 py-2.5 text-right">
                          {subHasEssay && s.status !== "graded" ? (
                            <button type="button" onClick={() => openGrading(s.id)} className="px-2.5 py-1 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md cursor-pointer">
                              Grade
                            </button>
                          ) : (
                            <button type="button" onClick={() => openGrading(s.id)} className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer">
                              Review
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {gradingId && gradingReview && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Review — {gradingReview.submission.total_score ?? gradingReview.submission.auto_score}/{subMaxScore}</h3>
                <button type="button" onClick={() => setGradingId(null)} className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer">
                  Close
                </button>
              </div>
              {gradingReview.questions.map((q: any, i: number) => (
                <div key={q.id} className="p-3 rounded-xl border border-slate-200">
                  <div className="text-xs font-semibold text-slate-800">
                    {i + 1}. {q.question_text} <span className="text-slate-400">({q.points} pt)</span>
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    Student answered: <span className="font-semibold">{q.student_answer || "(no answer)"}</span>
                  </div>
                  {q.question_type === "essay" ? (
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-[11px] font-semibold text-slate-500">Score:</label>
                      <input
                        type="number"
                        min={0}
                        max={q.points}
                        value={essayScores[q.id] ?? 0}
                        onChange={(e) => setEssayScores((prev) => ({ ...prev, [q.id]: Number(e.target.value) }))}
                        className="w-20 px-2 py-1 border border-slate-200 rounded-lg text-xs"
                      />
                      <span className="text-[11px] text-slate-400">/ {q.points}</span>
                    </div>
                  ) : (
                    <div className={`text-[11px] font-bold mt-1 ${q.correct ? "text-emerald-600" : "text-rose-600"}`}>
                      {q.correct ? "Correct" : `Incorrect — correct answer: ${q.correct_answer}`}
                    </div>
                  )}
                </div>
              ))}
              {subHasEssay && gradingReview.submission.status !== "graded" && (
                <button type="button" onClick={submitEssayGrades} className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer">
                  Save grades
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
