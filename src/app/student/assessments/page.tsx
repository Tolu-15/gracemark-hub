"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient, getAuthHeaders } from "@/lib/supabase/client";
import { resolveStudentUserIdCandidates } from "@/lib/auth";
import { PageLoader } from "@/components/shared/PageLoader";

interface ExamListItem {
  id: string;
  title: string;
  description: string | null;
  subject_id: string;
  term: string;
  duration_minutes: number;
  pass_mark: number;
  attempts_allowed: number;
  due_date: string | null;
  question_count: number;
  attempts_used: number;
  attempts_remaining: number;
  can_attempt: boolean;
  has_open_session: boolean;
  open_session_id: string | null;
  latest_submission: { id: string; status: string; total_score: number | null; passed: boolean } | null;
  subjects?: { name: string };
}

interface Question {
  id: string;
  question_text: string;
  question_type: "multiple_choice" | "true_false" | "fill_in_the_blank" | "short_answer" | "essay";
  options: string[] | null;
  points: number;
  position: number;
}

const MAX_TAB_SWITCHES = 3;

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(await getAuthHeaders()), ...(init?.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function formatSeconds(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function StudentAssessmentsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "instructions" | "quiz" | "result" | "review">("list");
  const [toast, setToast] = useState("");

  const [exams, setExams] = useState<ExamListItem[]>([]);
  const [selectedExam, setSelectedExam] = useState<ExamListItem | null>(null);

  // Quiz state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [shuffledOptions, setShuffledOptions] = useState<Record<string, string[]>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const submitLockRef = useRef(false);

  // Result / review state
  const [lastResult, setLastResult] = useState<any>(null);
  const [reviewData, setReviewData] = useState<any | null>(null);
  const [reviewSubmissionId, setReviewSubmissionId] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  };

  const loadExams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const candidateIds = await resolveStudentUserIdCandidates(user.id);
      const { data: studentRecord } = await supabase.from("students").select("id").in("user_id", candidateIds).maybeSingle();
      if (!studentRecord) throw new Error("Student profile record not found. Please contact administration.");

      const { res, json } = await api("/api/cbt/student/exams");
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load exams.");
      setExams(json.exams || []);
    } catch (err: any) {
      setError(err.message || "Failed to load exams.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  function localStorageKey(sid: string) {
    return `cbt_quiz_${sid}`;
  }

  function persistQuizState(sid: string, ans: Record<string, string>, switches: number, opts: Record<string, string[]>) {
    try {
      localStorage.setItem(localStorageKey(sid), JSON.stringify({ answers: ans, tabSwitches: switches, shuffledOptions: opts }));
    } catch {
      /* private-window/local-storage-full — quiz still works, just won't resume after a hard refresh */
    }
  }

  function loadPersistedQuizState(sid: string): { answers: Record<string, string>; tabSwitches: number; shuffledOptions: Record<string, string[]> } | null {
    try {
      const raw = localStorage.getItem(localStorageKey(sid));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearPersistedQuizState(sid: string) {
    try {
      localStorage.removeItem(localStorageKey(sid));
    } catch {
      /* ignore */
    }
  }

  async function openInstructions(exam: ExamListItem) {
    setSelectedExam(exam);
    setView("instructions");
  }

  async function beginExam(exam: ExamListItem) {
    try {
      const { res, json } = await api("/api/cbt/attempt/start", { method: "POST", body: JSON.stringify({ examId: exam.id }) });
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not start the exam.");
      const sid = json.sessionId as string;
      const { res: qRes, json: qJson } = await api(`/api/cbt/attempt/questions?sessionId=${sid}`);
      if (!qRes.ok || !qJson.ok) throw new Error(qJson.error || "Could not load exam questions.");

      const loadedQuestions: Question[] = qJson.questions || [];
      const persisted = loadPersistedQuizState(sid);
      const optionsMap: Record<string, string[]> = {};
      loadedQuestions.forEach((q) => {
        if (q.question_type === "multiple_choice" && Array.isArray(q.options)) {
          optionsMap[q.id] = persisted?.shuffledOptions?.[q.id] || fisherYatesShuffle(q.options);
        }
      });

      setSessionId(sid);
      setQuestions(loadedQuestions);
      setShuffledOptions(optionsMap);
      setAnswers(persisted?.answers || {});
      setTabSwitches(persisted?.tabSwitches || 0);
      setSecondsLeft(qJson.secondsLeft ?? 0);
      setCurrentIndex(0);
      submitLockRef.current = false;
      setView("quiz");
    } catch (err: any) {
      flash(err.message);
    }
  }

  const doSubmit = useCallback(
    async (finalTabSwitches: number) => {
      if (!sessionId || submitLockRef.current) return;
      submitLockRef.current = true;
      setSubmitting(true);
      try {
        const { res, json } = await api("/api/cbt/attempt/submit", {
          method: "POST",
          body: JSON.stringify({ sessionId, answers, tabSwitches: finalTabSwitches }),
        });
        if (!res.ok || !json.ok) throw new Error(json.error || "Could not submit the exam.");
        clearPersistedQuizState(sessionId);
        setLastResult(json);
        setView("result");
        loadExams();
      } catch (err: any) {
        flash(err.message);
        submitLockRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [sessionId, answers, loadExams]
  );

  // Countdown timer
  useEffect(() => {
    if (view !== "quiz") return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          doSubmit(tabSwitches);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Anti-cheat: tab-switch detection with 3-strike auto-submit
  useEffect(() => {
    if (view !== "quiz") return;
    function onVisibilityChange() {
      if (document.hidden) {
        setTabSwitches((prev) => {
          const next = prev + 1;
          if (sessionId) persistQuizState(sessionId, answers, next, shuffledOptions);
          if (next >= MAX_TAB_SWITCHES) {
            flash("Too many tab switches detected — your exam has been submitted automatically.");
            doSubmit(next);
          } else {
            flash(`Warning: leaving this tab is being recorded (${next}/${MAX_TAB_SWITCHES}).`);
          }
          return next;
        });
      }
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, sessionId, answers, shuffledOptions]);

  function setAnswer(questionId: string, value: string) {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value };
      if (sessionId) persistQuizState(sessionId, next, tabSwitches, shuffledOptions);
      return next;
    });
  }

  function blockClipboardEvent(e: React.SyntheticEvent) {
    e.preventDefault();
  }

  async function openReview(submissionId: string) {
    setReviewSubmissionId(submissionId);
    setView("review");
    const { res, json } = await api(`/api/cbt/attempt/review?submissionId=${submissionId}`);
    if (res.ok && json.ok) setReviewData(json);
  }

  const currentQuestion = questions[currentIndex];
  const answeredCount = useMemo(() => questions.filter((q) => (answers[q.id] || "").trim()).length, [questions, answers]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <PageLoader label="Loading exams…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <div className="text-center p-6 max-w-md bg-white rounded-xl border border-rose-200 shadow-sm">
          <p className="text-rose-700 font-semibold text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="portal-header bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">CBT Exams</h1>
        <p className="text-xs text-slate-500 mt-0.5">Timed online exams for your class. Once you start, the clock does not stop.</p>
      </header>

      <div className="p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-4 overflow-y-auto">
        {toast && <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">{toast}</div>}

        {view === "list" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {exams.length === 0 ? (
              <div className="col-span-full text-center py-16 text-slate-400 text-sm">No exams have been published for your class yet.</div>
            ) : (
              exams.map((exam) => {
                const isOverdue = exam.due_date && Date.now() > new Date(exam.due_date).getTime();
                return (
                  <div key={exam.id} className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-3">
                    <div>
                      <h3 className="font-bold text-slate-900">{exam.title}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {exam.subjects?.name || "Subject"} · {exam.question_count} question(s) · {exam.duration_minutes} min
                      </p>
                    </div>
                    {exam.description && <p className="text-xs text-slate-600">{exam.description}</p>}
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Attempts: {exam.attempts_used}/{exam.attempts_allowed}</span>
                      {exam.due_date && <span className={isOverdue ? "text-rose-600 font-semibold" : ""}>Due {new Date(exam.due_date).toLocaleDateString()}</span>}
                    </div>

                    {exam.latest_submission ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className={`px-2 py-1 rounded-lg text-[11px] font-bold ${exam.latest_submission.status === "graded" ? (exam.latest_submission.passed ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700") : "bg-amber-50 text-amber-700"}`}>
                          {exam.latest_submission.status === "graded" ? `Scored ${exam.latest_submission.total_score}` : "Awaiting grading"}
                        </span>
                        <button type="button" onClick={() => openReview(exam.latest_submission!.id)} className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer">
                          Review
                        </button>
                      </div>
                    ) : null}

                    {exam.has_open_session ? (
                      <button type="button" onClick={() => beginExam(exam)} className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs cursor-pointer">
                        Resume exam in progress
                      </button>
                    ) : exam.can_attempt ? (
                      <button type="button" onClick={() => openInstructions(exam)} className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer">
                        Start Exam
                      </button>
                    ) : (
                      <div className="w-full py-2 text-center text-[11px] font-semibold text-slate-400 bg-slate-50 rounded-xl">
                        {isOverdue ? "Deadline passed" : "No attempts remaining"}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {view === "instructions" && selectedExam && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-4 max-w-lg mx-auto">
            <h2 className="text-lg font-bold text-slate-900">{selectedExam.title}</h2>
            <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4">
              <li>You have <strong>{selectedExam.duration_minutes} minutes</strong> once you start — the timer keeps running even if you leave the page.</li>
              <li>This exam has {selectedExam.question_count} question(s), worth a total of the marks set by your teacher.</li>
              <li>Switching tabs or windows is recorded. After {MAX_TAB_SWITCHES} switches, your exam is auto-submitted.</li>
              <li>Copy, paste and right-click are disabled during the exam.</li>
              <li>You can move between questions and change answers until you submit or time runs out.</li>
              <li>You have {selectedExam.attempts_remaining} attempt(s) remaining for this exam.</li>
            </ul>
            <div className="flex gap-2">
              <button type="button" onClick={() => setView("list")} className="flex-1 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={() => beginExam(selectedExam)} className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer">
                I&apos;m ready — Start
              </button>
            </div>
          </div>
        )}

        {view === "quiz" && currentQuestion && (
          <div onCopy={blockClipboardEvent} onCut={blockClipboardEvent} onPaste={blockClipboardEvent} onContextMenu={blockClipboardEvent} className="space-y-4 select-none">
            <div className="flex items-center justify-between bg-white border border-slate-200/80 rounded-2xl px-4 py-3 shadow-xs sticky top-0 z-10">
              <span className="text-xs font-semibold text-slate-500">
                Question {currentIndex + 1} of {questions.length} · {answeredCount} answered
              </span>
              <span className={`text-sm font-bold px-3 py-1 rounded-lg ${secondsLeft < 60 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"}`}>
                ⏱ {formatSeconds(secondsLeft)}
              </span>
            </div>

            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-4">
              <p className="text-sm font-semibold text-slate-900">{currentQuestion.question_text}</p>

              {currentQuestion.question_type === "multiple_choice" && (
                <div className="space-y-2">
                  {(shuffledOptions[currentQuestion.id] || currentQuestion.options || []).map((opt, i) => (
                    <label key={i} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${answers[currentQuestion.id] === opt ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                      <input type="radio" name={currentQuestion.id} checked={answers[currentQuestion.id] === opt} onChange={() => setAnswer(currentQuestion.id, opt)} />
                      <span className="text-sm text-slate-800">{opt}</span>
                    </label>
                  ))}
                </div>
              )}

              {currentQuestion.question_type === "true_false" && (
                <div className="flex gap-3">
                  {["True", "False"].map((opt) => (
                    <label key={opt} className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer ${answers[currentQuestion.id] === opt ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                      <input type="radio" name={currentQuestion.id} checked={answers[currentQuestion.id] === opt} onChange={() => setAnswer(currentQuestion.id, opt)} />
                      <span className="text-sm font-semibold text-slate-800">{opt}</span>
                    </label>
                  ))}
                </div>
              )}

              {(currentQuestion.question_type === "fill_in_the_blank" || currentQuestion.question_type === "short_answer") && (
                <input
                  type="text"
                  value={answers[currentQuestion.id] || ""}
                  onChange={(e) => setAnswer(currentQuestion.id, e.target.value)}
                  placeholder="Type your answer…"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
              )}

              {currentQuestion.question_type === "essay" && (
                <textarea
                  value={answers[currentQuestion.id] || ""}
                  onChange={(e) => setAnswer(currentQuestion.id, e.target.value)}
                  rows={6}
                  placeholder="Write your answer… (graded manually by your teacher)"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setCurrentIndex(i)}
                  className={`w-8 h-8 rounded-lg text-[11px] font-bold cursor-pointer ${
                    i === currentIndex ? "bg-slate-900 text-white" : (answers[q.id] || "").trim() ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            <div className="flex justify-between gap-2">
              <button type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((i) => i - 1)} className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer">
                ← Previous
              </button>
              {currentIndex < questions.length - 1 ? (
                <button type="button" onClick={() => setCurrentIndex((i) => i + 1)} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer">
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    if (window.confirm("Submit your answers now? You cannot change them after this.")) doSubmit(tabSwitches);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Submit Exam"}
                </button>
              )}
            </div>
          </div>
        )}

        {view === "result" && lastResult && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-8 shadow-xs text-center space-y-4 max-w-md mx-auto">
            {lastResult.hasManualQuestions ? (
              <>
                <div className="text-4xl">📝</div>
                <h2 className="text-lg font-bold text-slate-900">Exam submitted!</h2>
                <p className="text-xs text-slate-500">This exam has essay questions that need manual grading. Your teacher will grade it soon.</p>
              </>
            ) : (
              <>
                <div className="text-4xl">{lastResult.passed ? "🎉" : "📊"}</div>
                <h2 className="text-lg font-bold text-slate-900">
                  Score: {lastResult.totalScore}/{lastResult.maxScore}
                </h2>
                <p className={`text-sm font-bold ${lastResult.passed ? "text-emerald-600" : "text-rose-600"}`}>{lastResult.passed ? "You passed!" : "Below pass mark"}</p>
              </>
            )}
            <button type="button" onClick={() => setView("list")} className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer">
              Back to exams
            </button>
          </div>
        )}

        {view === "review" && (
          <div className="space-y-4">
            <button type="button" onClick={() => setView("list")} className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
              ← Back to exams
            </button>
            {!reviewData ? (
              <PageLoader label="Loading review…" />
            ) : (
              <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-4">
                <h2 className="text-lg font-bold text-slate-900">{reviewData.exam.title}</h2>
                <p className="text-sm font-bold text-slate-700">
                  Score: {reviewData.submission.total_score ?? reviewData.submission.auto_score} · {reviewData.submission.status === "graded" ? (reviewData.submission.passed ? "Passed" : "Did not pass") : "Awaiting grading"}
                </p>
                {reviewData.questions.map((q: any, i: number) => (
                  <div key={q.id} className="p-3 rounded-xl border border-slate-200">
                    <p className="text-xs font-semibold text-slate-800">
                      {i + 1}. {q.question_text}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">Your answer: {q.student_answer || "(no answer)"}</p>
                    {q.question_type !== "essay" && (
                      <p className={`text-[11px] font-bold mt-1 ${q.correct ? "text-emerald-600" : "text-rose-600"}`}>
                        {q.correct ? "Correct" : `Incorrect — correct answer: ${q.correct_answer}`}
                      </p>
                    )}
                    {q.explanation && <p className="text-[11px] text-slate-500 mt-1 italic">{q.explanation}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
