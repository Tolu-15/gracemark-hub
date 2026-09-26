"use client";

import React, { useState, useEffect } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { supabase } from "@/lib/supabase/client";

interface ClassOption {
  id: string;
  name: string;
}

interface CBTExam {
  id: string;
  title: string;
  description?: string | null;
  class_id?: string | null;
  duration_minutes: number;
  pass_mark: number;
  is_published: boolean;
  created_at: string;
  classes?: { name: string } | null;
  cbt_questions?: { count: number }[];
  cbt_submissions?: { count: number }[];
}

interface CBTQuestion {
  id: string;
  exam_id: string;
  question_text: string;
  options: string[];
  correct_option_index: number;
  points?: number;
  created_at?: string;
}

export default function AdminExamsPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [exams, setExams] = useState<CBTExam[]>([]);
  const [loading, setLoading] = useState(true);

  // Create Exam Modal
  const [isExamModalOpen, setIsExamModalOpen] = useState(false);
  const [examTitle, setExamTitle] = useState("");
  const [examDesc, setExamDesc] = useState("");
  const [examClassId, setExamClassId] = useState("");
  const [examDuration, setExamDuration] = useState(30);
  const [examPassMark, setExamPassMark] = useState(50);
  const [examIsPublished, setExamIsPublished] = useState(false);
  const [savingExam, setSavingExam] = useState(false);

  // Questions Modal
  const [isQuestionsModalOpen, setIsQuestionsModalOpen] = useState(false);
  const [currentExam, setCurrentExam] = useState<CBTExam | null>(null);
  const [questions, setQuestions] = useState<CBTQuestion[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  // Add Question Form
  const [qText, setQText] = useState("");
  const [optA, setOptA] = useState("");
  const [optB, setOptB] = useState("");
  const [optC, setOptC] = useState("");
  const [optD, setOptD] = useState("");
  const [correctIdx, setCorrectIdx] = useState(0);
  const [savingQuestion, setSavingQuestion] = useState(false);

  const loadClasses = async () => {
    const { data } = await supabase.from("classes").select("id, name").order("name");
    const cls = data || [];
    setClasses(cls);
    if (cls.length > 0 && !examClassId) {
      setExamClassId(cls[0].id);
    }
  };

  const loadExams = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cbt_exams")
        .select("*, classes(name), cbt_questions(count), cbt_submissions(count)")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setExams((data as any) || []);
    } catch (err: any) {
      console.error("Failed to load exams:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClasses();
    loadExams();
  }, []);

  const handleTogglePublish = async (exam: CBTExam) => {
    try {
      const { error } = await supabase
        .from("cbt_exams")
        .update({ is_published: !exam.is_published })
        .eq("id", exam.id);
      if (error) throw error;
      await loadExams();
    } catch (err: any) {
      alert("Failed to update status: " + err.message);
    }
  };

  const handleDeleteExam = async (examId: string) => {
    if (!confirm("Are you sure you want to delete this CBT exam? All questions and student results will be removed.")) {
      return;
    }
    try {
      const { error } = await supabase.from("cbt_exams").delete().eq("id", examId);
      if (error) throw error;
      await loadExams();
    } catch (err: any) {
      alert("Failed to delete exam: " + err.message);
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examTitle.trim() || !examClassId) {
      alert("Please enter an exam title and select a class.");
      return;
    }
    setSavingExam(true);
    try {
      const { data, error } = await supabase
        .from("cbt_exams")
        .insert([
          {
            title: examTitle.trim(),
            description: examDesc.trim() || null,
            class_id: examClassId,
            duration_minutes: Number(examDuration) || 30,
            pass_mark: Number(examPassMark) || 50,
            is_published: examIsPublished,
          },
        ])
        .select("*, classes(name), cbt_questions(count)")
        .single();

      if (error) throw error;

      setIsExamModalOpen(false);
      setExamTitle("");
      setExamDesc("");
      setExamDuration(30);
      setExamPassMark(50);
      setExamIsPublished(false);

      await loadExams();
      if (data) {
        openQuestionsModal(data as any);
      }
    } catch (err: any) {
      alert("Failed to create exam: " + err.message);
    } finally {
      setSavingExam(false);
    }
  };

  const openQuestionsModal = async (exam: CBTExam) => {
    setCurrentExam(exam);
    setIsQuestionsModalOpen(true);
    await loadQuestions(exam.id);
  };

  const loadQuestions = async (examId: string) => {
    setLoadingQuestions(true);
    try {
      const { data, error } = await supabase
        .from("cbt_questions")
        .select("*")
        .eq("exam_id", examId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setQuestions((data as any) || []);
    } catch (err: any) {
      console.error("Error loading questions:", err);
    } finally {
      setLoadingQuestions(false);
    }
  };

  const handleAddQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentExam) return;

    const trimmedText = qText.trim();
    const options = [optA.trim(), optB.trim(), optC.trim(), optD.trim()];
    if (!trimmedText || options.some((o) => !o)) {
      alert("Please fill in question text and all 4 options.");
      return;
    }

    setSavingQuestion(true);
    try {
      const { error } = await supabase.from("cbt_questions").insert([
        {
          exam_id: currentExam.id,
          question_text: trimmedText,
          options,
          correct_option_index: correctIdx,
          points: 1,
        },
      ]);
      if (error) throw error;

      setQText("");
      setOptA("");
      setOptB("");
      setOptC("");
      setOptD("");
      setCorrectIdx(0);

      await loadQuestions(currentExam.id);
      await loadExams();
    } catch (err: any) {
      alert("Failed to save question: " + err.message);
    } finally {
      setSavingQuestion(false);
    }
  };

  const handleDeleteQuestion = async (qId: string) => {
    if (!currentExam) return;
    try {
      const { error } = await supabase.from("cbt_questions").delete().eq("id", qId);
      if (error) throw error;
      await loadQuestions(currentExam.id);
      await loadExams();
    } catch (err: any) {
      alert("Failed to delete question: " + err.message);
    }
  };

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="portal-header bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">CBT Exam Manager</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload online exams for each class, manage questions, and set timers.
            </p>
          </div>
          <button
            onClick={() => setIsExamModalOpen(true)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow transition text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
            </svg>
            Create CBT Exam
          </button>
        </header>

        <div className="p-6 max-w-7xl mx-auto w-full space-y-6 overflow-y-auto">
          {loading ? (
            <div className="text-center py-12 text-slate-400">
              <div className="w-6 h-6 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading CBT exams...
            </div>
          ) : exams.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-slate-800">No CBT Exams Created Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Create online exams for each class, add multiple choice questions, set timers, and publish them for students.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {exams.map((exam) => {
                const qCount = exam.cbt_questions?.[0]?.count || 0;

                return (
                  <div
                    key={exam.id}
                    className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span
                          className={`px-2.5 py-1 text-[11px] font-bold uppercase rounded-full ${
                            exam.is_published ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {exam.is_published ? "Published" : "Draft"}
                        </span>
                        <span className="text-xs text-slate-400 font-semibold">{exam.duration_minutes} Mins</span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 leading-snug">{exam.title}</h3>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {exam.description || "No instructions provided."}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600">
                      <span>
                        Class: <strong className="text-slate-900">{exam.classes?.name || "General"}</strong>
                      </span>
                      <span>
                        Questions: <strong className="text-indigo-600">{qCount}</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => openQuestionsModal(exam)}
                        className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
                      >
                        <svg className="w-4 h-4 text-indigo-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Manage Questions
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTogglePublish(exam)}
                        className="px-3 py-2 border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold transition"
                      >
                        {exam.is_published ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteExam(exam.id)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition"
                        title="Delete Exam"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create/Edit Exam Modal */}
        {isExamModalOpen && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-lg font-bold text-slate-900">Create CBT Exam</h3>
                <button
                  type="button"
                  onClick={() => setIsExamModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl font-bold"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleCreateExam} className="space-y-4 text-sm">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Exam Title *</label>
                  <input
                    type="text"
                    required
                    value={examTitle}
                    onChange={(e) => setExamTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-600"
                    placeholder="e.g. Mathematics Mid-Term Entrance Test"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Description / Exam Instructions</label>
                  <textarea
                    value={examDesc}
                    onChange={(e) => setExamDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-600"
                    rows={2}
                    placeholder="Instructions for students..."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Target Class *</label>
                    <select
                      required
                      value={examClassId}
                      onChange={(e) => setExamClassId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-600 bg-white"
                    >
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Duration (Minutes)</label>
                    <input
                      type="number"
                      min="5"
                      max="180"
                      value={examDuration}
                      onChange={(e) => setExamDuration(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Pass Mark (%)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={examPassMark}
                      onChange={(e) => setExamPassMark(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-600"
                    />
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="examIsPublishedInput"
                    checked={examIsPublished}
                    onChange={(e) => setExamIsPublished(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                  />
                  <label htmlFor="examIsPublishedInput" className="font-semibold text-slate-700 text-xs cursor-pointer">
                    Publish immediately (visible to students in target class)
                  </label>
                </div>

                <div className="pt-3 flex justify-end gap-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsExamModalOpen(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingExam}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow"
                  >
                    {savingExam ? "Saving..." : "Save Exam & Add Questions"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Questions Builder Modal */}
        {isQuestionsModalOpen && currentExam && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{currentExam.title}</h3>
                  <p className="text-xs text-slate-500">Manage multiple choice questions for this exam.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsQuestionsModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl font-bold"
                >
                  &times;
                </button>
              </div>

              {/* Add New Question Form */}
              <form onSubmit={handleAddQuestion} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 text-xs">
                <h4 className="font-bold text-slate-800 text-sm">Add New Question</h4>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Question Text *</label>
                  <input
                    type="text"
                    required
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg outline-none focus:border-indigo-600 text-xs"
                    placeholder="e.g. What is the value of 2 + 2?"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">Option A *</label>
                    <input
                      type="text"
                      required
                      value={optA}
                      onChange={(e) => setOptA(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none"
                      placeholder="Option A"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">Option B *</label>
                    <input
                      type="text"
                      required
                      value={optB}
                      onChange={(e) => setOptB(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none"
                      placeholder="Option B"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">Option C *</label>
                    <input
                      type="text"
                      required
                      value={optC}
                      onChange={(e) => setOptC(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none"
                      placeholder="Option C"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">Option D *</label>
                    <input
                      type="text"
                      required
                      value={optD}
                      onChange={(e) => setOptD(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none"
                      placeholder="Option D"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 pt-1">
                  <div className="flex-1">
                    <label className="block font-semibold text-slate-600 mb-1">Correct Answer *</label>
                    <select
                      value={correctIdx}
                      onChange={(e) => setCorrectIdx(Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg outline-none font-bold text-indigo-700"
                    >
                      <option value={0}>Option A</option>
                      <option value={1}>Option B</option>
                      <option value={2}>Option C</option>
                      <option value={3}>Option D</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={savingQuestion}
                    className="self-end px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow text-xs"
                  >
                    {savingQuestion ? "Saving..." : "+ Save Question"}
                  </button>
                </div>
              </form>

              {/* Questions List */}
              <div className="space-y-3">
                <h4 className="font-bold text-slate-800 text-sm">Exam Question Bank ({questions.length})</h4>
                <div className="space-y-3">
                  {loadingQuestions ? (
                    <p className="text-xs text-slate-400 italic">Loading questions...</p>
                  ) : questions.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">
                      No questions added yet. Use the form above to add your first question.
                    </p>
                  ) : (
                    questions.map((q, idx) => {
                      const opts = Array.isArray(q.options) ? q.options : [];
                      const optionLabels = ["A", "B", "C", "D"];

                      return (
                        <div key={q.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <h5 className="font-bold text-slate-900">
                              <span className="text-indigo-600">Q{idx + 1}.</span> {q.question_text}
                            </h5>
                            <button
                              type="button"
                              onClick={() => handleDeleteQuestion(q.id)}
                              className="text-red-500 hover:text-red-700 font-bold px-1"
                            >
                              &times;
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            {opts.map((opt, oIdx) => (
                              <div
                                key={oIdx}
                                className={`px-2.5 py-1.5 rounded border ${
                                  oIdx === q.correct_option_index
                                    ? "bg-emerald-50 border-emerald-300 text-emerald-900 font-bold"
                                    : "bg-white border-slate-200 text-slate-700"
                                }`}
                              >
                                <strong>{optionLabels[oIdx]}:</strong> {opt}
                                {oIdx === q.correct_option_index ? " ✓" : ""}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
