"use client";

import React, { useState, useEffect, useRef } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import { resolveStudentUserIdCandidates } from "@/lib/auth";

interface StudentAssessment {
  id: string;
  title: string;
  description?: string | null;
  assessment_type: string;
  duration: number;
  total_marks: number;
  pass_mark: number;
  instructions?: string | null;
  subjects?: { name: string } | null;
  allow_result_view: boolean;
  is_cbt?: boolean;
  submission?: {
    id: string;
    status: string;
    total_score?: number | null;
    percentage?: number | null;
  } | null;
}

interface AttemptQuestion {
  id: string;
  question: string;
  question_type: string;
  options: string[] | null;
  correct_answer: string;
  marks: number;
  explanation?: string | null;
}

interface AnswerReview {
  question_id: string;
  student_answer?: string | null;
  awarded_marks?: number | null;
  is_correct?: boolean | null;
  teacher_feedback?: string | null;
}

export default function StudentAssessmentsPage() {
  const [view, setView] = useState<"list" | "instructions" | "quiz" | "results">("list");
  const [loading, setLoading] = useState(true);

  const [studentId, setStudentId] = useState<string>("");
  const [classId, setClassId] = useState<string>("");
  const [assessments, setAssessments] = useState<StudentAssessment[]>([]);
  const [typeFilter, setTypeFilter] = useState("");

  // Instructions State
  const [selectedAssessment, setSelectedAssessment] = useState<StudentAssessment | null>(null);
  const [questionCount, setQuestionCount] = useState(0);

  // Quiz State
  const [questions, setQuestions] = useState<AttemptQuestion[]>([]);
  const [studentAnswers, setStudentAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [submissionId, setSubmissionId] = useState<string>("");
  const [startTime, setStartTime] = useState<Date | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Results State
  const [reviewSubmission, setReviewSubmission] = useState<any>(null);
  const [reviewQuestions, setReviewQuestions] = useState<AttemptQuestion[]>([]);
  const [reviewAnswers, setReviewAnswers] = useState<AnswerReview[]>([]);
  const [reviewSubject, setReviewSubject] = useState("");

  const [profileError, setProfileError] = useState<string | null>(null);

  const loadStudentData = async () => {
    setLoading(true);
    setProfileError(null);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) return;

      const candidateIds = await resolveStudentUserIdCandidates(user.id);
      const { data: student } = await supabase
        .from("students")
        .select("id, class_id")
        .in("user_id", candidateIds)
        .maybeSingle();

      if (!student) {
        setProfileError("No student record found linked to your account. Please contact the Gracemark Academy administration.");
        return;
      }

      setStudentId(student.id);
      setClassId(student.class_id || "");
      await loadAssessments(student.id, student.class_id);
    } catch (err: any) {
      console.error("Failed to load student data:", err);
      setProfileError(err.message || "Failed to load student data.");
    } finally {
      setLoading(false);
    }
  };

  const loadAssessments = async (sId: string, cId?: string) => {
    try {
      if (!cId) {
        setAssessments([]);
        return;
      }

      const { data: cbtData, error: cbtErr } = await supabase
        .from("cbt_exams")
        .select("*, subjects(name)")
        .eq("class_id", cId)
        .eq("is_published", true)
        .order("created_at", { ascending: false });

      if (cbtErr) throw cbtErr;

      const exams: StudentAssessment[] = (cbtData || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        assessment_type: "CBT Online Exam",
        duration: c.duration_minutes || 30,
        total_marks: c.pass_mark * 2 || 100,
        pass_mark: c.pass_mark || 50,
        instructions: c.description || "Complete all questions before time expires.",
        subjects: c.subjects,
        allow_result_view: true,
        is_cbt: true,
      }));

      // Fetch student submissions for these exams
      const examIds = exams.map((e) => e.id);
      if (examIds.length > 0) {
        const { data: subData } = await supabase
          .from("cbt_submissions")
          .select("id, exam_id, score, total_questions, passed, submitted_at")
          .in("exam_id", examIds)
          .eq("student_id", sId);

        const subMap = new Map();
        (subData || []).forEach((s) => subMap.set(s.exam_id, s));

        exams.forEach((e) => {
          const sub = subMap.get(e.id);
          if (sub) {
            e.submission = {
              id: sub.id,
              status: "graded",
              total_score: sub.score,
              percentage: sub.total_questions > 0 ? (sub.score / sub.total_questions) * 100 : 0,
            };
          } else {
            e.submission = null;
          }
        });
      }

      setAssessments(exams);
    } catch (err) {
      console.error("Load assessments error:", err);
    }
  };

  useEffect(() => {
    loadStudentData();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const filteredAssessments = assessments.filter((a) => {
    if (typeFilter && a.assessment_type !== typeFilter) return false;
    return true;
  });

  // Open Instructions
  const openInstructions = async (a: StudentAssessment) => {
    setSelectedAssessment(a);
    const { count } = await supabase
      .from("cbt_questions")
      .select("id", { count: "exact", head: true })
      .eq("exam_id", a.id);
    setQuestionCount(count || 0);
    setView("instructions");
  };

  // Start Quiz Attempt
  const startQuizAttempt = async () => {
    if (!selectedAssessment) return;
    if (!confirm("Do you want to start this assessment now? The timer will start immediately.")) return;

    setLoading(true);
    try {
      const { data: qData, error: qErr } = await supabase
        .from("cbt_questions")
        .select("*")
        .eq("exam_id", selectedAssessment.id)
        .order("created_at", { ascending: true });

      if (qErr) throw qErr;

      const qList: AttemptQuestion[] = (qData || []).map((q: any) => ({
        id: q.id,
        question: q.question_text,
        question_type: "Multiple Choice",
        options: Array.isArray(q.options) ? q.options : [],
        correct_answer: String(q.correct_option_index),
        marks: q.points || 1,
      }));

      if (!qList.length) {
        alert("This exam currently has no questions configured.");
        setLoading(false);
        return;
      }

      setQuestions(qList);
      const initialAns: Record<string, string> = {};
      qList.forEach((q) => {
        initialAns[q.id] = "";
      });
      setStudentAnswers(initialAns);
      setCurrentIndex(0);

      const now = new Date();
      setStartTime(now);

      const { data: cbtSub, error: subErr } = await supabase
        .from("cbt_submissions")
        .upsert(
          [
            {
              exam_id: selectedAssessment.id,
              student_id: studentId,
              score: 0,
              total_questions: qList.length,
              passed: false,
              answers: {},
            },
          ],
          { onConflict: "exam_id,student_id" }
        )
        .select()
        .single();

      if (subErr) throw subErr;
      setSubmissionId(cbtSub.id);

      // Timer
      const totalSecs = (selectedAssessment.duration || 30) * 60;
      setSecondsRemaining(totalSecs);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            alert("Time has expired! Submitting your answers automatically.");
            handleFinalSubmit(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      setView("quiz");
    } catch (err: any) {
      alert("Failed to start assessment: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAnswer = (qId: string, val: string) => {
    setStudentAnswers((prev) => ({ ...prev, [qId]: val }));
  };

  const handleFinalSubmit = async (auto = false) => {
    if (!auto && !confirm("Are you sure you want to submit your assessment? You cannot make changes after this.")) {
      return;
    }

    if (timerRef.current) clearInterval(timerRef.current);
    setLoading(true);

    try {
      const submitTime = new Date();
      let autoMarksTotal = 0;
      let totalPossibleMarks = 0;

      const answersPayload: AnswerReview[] = questions.map((q) => {
        const studentAns = studentAnswers[q.id] || "";
        const isCorrect = String(studentAns).trim() === String(q.correct_answer).trim();
        const awardedMarks = isCorrect ? q.marks : 0;
        autoMarksTotal += awardedMarks;
        totalPossibleMarks += q.marks;

        return {
          question_id: q.id,
          student_answer: studentAns,
          awarded_marks: awardedMarks,
          is_correct: isCorrect,
        };
      });

      const percentage = totalPossibleMarks > 0 ? (autoMarksTotal / totalPossibleMarks) * 100 : 0;
      const isPassed = percentage >= (selectedAssessment?.pass_mark || 50);

      // 1. Update cbt_submissions
      await supabase
        .from("cbt_submissions")
        .upsert(
          {
            exam_id: selectedAssessment?.id,
            student_id: studentId,
            score: autoMarksTotal,
            total_questions: questions.length,
            passed: isPassed,
            answers: studentAnswers,
            submitted_at: submitTime.toISOString(),
          },
          { onConflict: "exam_id,student_id" }
        );

      // 2. Automatically sync to Academic Gradebook Results via Server Bridge
      try {
        await fetch("/api/admin/exams/import-to-gradebook", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
          body: JSON.stringify({ examId: selectedAssessment?.id }),
        });
      } catch (syncErr) {
        console.warn("Auto gradebook sync warning:", syncErr);
      }

      alert("Assessment submitted and graded successfully!");

      setReviewSubmission({
        id: submissionId,
        status: "graded",
        total_score: autoMarksTotal,
        assessments: {
          total_marks: totalPossibleMarks,
          pass_mark: selectedAssessment?.pass_mark || 50,
        },
      });
      setReviewQuestions(questions);
      setReviewAnswers(answersPayload);
      setReviewSubject(selectedAssessment?.subjects?.name || "Subject Review");
      setView("results");
    } catch (err: any) {
      alert("Failed to submit assessment: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const openResultsReview = async (subId: string, subjectName: string) => {
    setLoading(true);
    setReviewSubject(subjectName || "Subject Details");

    try {
      const { data: sub, error } = await supabase
        .from("cbt_submissions")
        .select("*, cbt_exams(*)")
        .eq("id", subId)
        .single();
      if (error) throw error;

      const exam = sub.cbt_exams;
      const { data: qData } = await supabase
        .from("cbt_questions")
        .select("*")
        .eq("exam_id", exam.id)
        .order("created_at", { ascending: true });

      const qList: AttemptQuestion[] = (qData || []).map((q: any) => ({
        id: q.id,
        question: q.question_text,
        question_type: "Multiple Choice",
        options: Array.isArray(q.options) ? q.options : [],
        correct_answer: String(q.correct_option_index),
        marks: q.points || 1,
      }));

      const storedAnswers = sub.answers || {};
      let totalPossible = 0;
      const reviewAns: AnswerReview[] = qList.map((q) => {
        const studentAns = storedAnswers[q.id] || "";
        const isCorrect = String(studentAns).trim() === String(q.correct_answer).trim();
        totalPossible += q.marks;
        return {
          question_id: q.id,
          student_answer: studentAns,
          awarded_marks: isCorrect ? q.marks : 0,
          is_correct: isCorrect,
        };
      });

      setReviewSubmission({
        id: sub.id,
        status: "graded",
        total_score: sub.score,
        assessments: {
          total_marks: totalPossible || 100,
          pass_mark: exam.pass_mark || 50,
        },
      });
      setReviewQuestions(qList);
      setReviewAnswers(reviewAns);

      setView("results");
    } catch (err: any) {
      alert("Could not load result review: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const activeQ = questions[currentIndex];

  return (
    <AuthGuard allowedRoles={["student"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="portal-header bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 shrink-0">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">My Assessments</h1>
            <p className="text-sm text-slate-500 mt-1">Take quizzes and examinations assigned to your class.</p>
          </div>
        </header>

        <div className="portal-content p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full flex-1 overflow-y-auto">
          {/* 1. LIST VIEW */}
          {view === "list" && (
            <div className="space-y-6">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Assigned Assessments</h3>
                <div className="flex items-center gap-2">
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="">All Types</option>
                    <option value="Test 1 (Week 3)">Test 1 (Week 3)</option>
                    <option value="Test 2 (Week 6)">Test 2 (Week 6)</option>
                    <option value="Test 3 (Week 9)">Test 3 (Week 9)</option>
                    <option value="Term Exam">Term Exam</option>
                    <option value="Practice Questions">Practice Questions</option>
                  </select>
                </div>
              </div>

              {profileError ? (
                <div className="p-8 text-center bg-white border border-rose-200 rounded-xl shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-3 text-lg font-bold">!</div>
                  <h3 className="text-base font-bold text-slate-800">Student Profile Not Linked</h3>
                  <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{profileError}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {loading ? (
                    <div className="col-span-full p-8 text-center text-slate-500 bg-white border border-slate-200 rounded-xl shadow-sm">
                      Loading assessments...
                    </div>
                  ) : filteredAssessments.length === 0 ? (
                    <div className="col-span-full p-8 text-center text-slate-500 bg-white border border-slate-200 rounded-xl shadow-sm">
                      No assessments assigned to your class.
                    </div>
                  ) : (
                  filteredAssessments.map((a) => {
                    const sub = a.submission;
                    const isGraded = sub?.status === "graded";
                    const isSubmitted = Boolean(sub);

                    return (
                      <article
                        key={a.id}
                        className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow"
                      >
                        <div>
                          <div className="flex justify-between items-start mb-3">
                            {isGraded ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                Graded
                              </span>
                            ) : isSubmitted ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                Submitted
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-100">
                                Pending
                              </span>
                            )}
                            <span className="text-xs text-slate-400 font-bold uppercase">{a.assessment_type}</span>
                          </div>
                          <h3 className="text-base font-bold text-slate-900 mb-1">{a.title}</h3>
                          <p className="text-xs text-slate-500 mb-4 line-clamp-2">
                            {a.description || "No description provided."}
                          </p>

                          <div className="grid grid-cols-2 gap-y-2 border-t border-slate-100 pt-3 mb-4 text-xs">
                            <div>
                              <span className="text-slate-400 font-medium">Subject:</span>{" "}
                              <strong className="text-slate-700">{a.subjects?.name || "—"}</strong>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium">Duration:</span>{" "}
                              <strong className="text-slate-700">{a.duration} mins</strong>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium">Marks:</span>{" "}
                              <strong className="text-slate-700">{a.total_marks} marks</strong>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium">Pass Mark:</span>{" "}
                              <strong className="text-slate-700">{a.pass_mark} marks</strong>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2">
                          {isSubmitted ? (
                            a.allow_result_view || isGraded ? (
                              <button
                                onClick={() => openResultsReview(sub!.id, a.subjects?.name || "")}
                                className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700"
                              >
                                View Results
                              </button>
                            ) : (
                              <button
                                disabled
                                className="w-full px-4 py-2 border border-slate-200 text-slate-400 rounded-lg text-sm font-semibold cursor-not-allowed"
                              >
                                Results Pending
                              </button>
                            )
                          ) : (
                            <button
                              onClick={() => openInstructions(a)}
                              className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700"
                            >
                              Start Assessment
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
              )}
            </div>
          )}

          {/* 2. INSTRUCTIONS VIEW */}
          {view === "instructions" && selectedAssessment && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Assessment Instructions</h2>
                <button
                  onClick={() => setView("list")}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-100 transition-colors text-sm"
                >
                  Back
                </button>
              </div>

              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                <div className="border-b pb-4">
                  <h3 className="text-lg font-bold text-slate-900">{selectedAssessment.title}</h3>
                  <p className="text-sm text-slate-500 mt-1">{selectedAssessment.description || "No description provided."}</p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Duration</div>
                    <div className="text-base font-bold text-slate-800">{selectedAssessment.duration} mins</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Questions</div>
                    <div className="text-base font-bold text-slate-800">{questionCount}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Max Score</div>
                    <div className="text-base font-bold text-slate-800">{selectedAssessment.total_marks}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pass Mark</div>
                    <div className="text-base font-bold text-slate-800">{selectedAssessment.pass_mark}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Instructions</h4>
                  <div className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-200 whitespace-pre-wrap">
                    {selectedAssessment.instructions || "Follow all instructions. Check your answers carefully before final submission."}
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-xs flex items-start gap-3">
                  <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <span className="font-bold">Important Notice:</span> Once you start, the timer cannot be paused.
                    Make sure you have a stable internet connection. When the timer expires, current answers submit automatically.
                  </div>
                </div>

                <button
                  onClick={startQuizAttempt}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow transition-colors text-sm"
                >
                  Start Assessment Now
                </button>
              </div>
            </div>
          )}

          {/* 3. QUIZ VIEW */}
          {view === "quiz" && activeQ && (
            <div className="space-y-6">
              {/* Sticky Top Timer Bar */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-wrap gap-4 items-center justify-between sticky top-0 z-10">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{selectedAssessment?.title}</h3>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">
                    {selectedAssessment?.subjects?.name || "Subject"}
                  </div>
                </div>
                <div
                  className={`flex items-center gap-3 border rounded-lg px-4 py-2 ${
                    secondsRemaining < 300 ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-slate-50 border-slate-200 text-slate-800"
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="font-mono text-lg font-bold">{formatTimer(secondsRemaining)}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                {/* Navigation Grid */}
                <div className="lg:col-span-1 bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Question Navigator</h4>
                  <div className="grid grid-cols-5 gap-2 text-center font-bold text-sm">
                    {questions.map((q, idx) => {
                      const isAnswered = Boolean(studentAnswers[q.id]);
                      const isCurrent = currentIndex === idx;

                      let cls = "w-10 h-10 rounded-lg flex items-center justify-center font-bold transition-all border ";
                      if (isCurrent) cls += "border-2 border-indigo-600 text-indigo-600 ";
                      else if (isAnswered) cls += "bg-emerald-100 border-emerald-300 text-emerald-800 ";
                      else cls += "bg-slate-100 border-slate-200 text-slate-600 ";

                      return (
                        <button key={q.id} onClick={() => setCurrentIndex(idx)} className={cls}>
                          {idx + 1}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-col gap-2 pt-2 border-t text-[11px] text-slate-500 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded bg-emerald-100 border border-emerald-300 inline-block" />
                      <span>Answered</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded bg-white border-2 border-indigo-600 inline-block" />
                      <span>Current</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded bg-slate-100 border border-slate-200 inline-block" />
                      <span>Unanswered</span>
                    </div>
                  </div>
                </div>

                {/* Active Question */}
                <div className="lg:col-span-3 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                  <div className="flex justify-between items-center border-b pb-3">
                    <span className="text-sm font-semibold text-slate-500">
                      Question {currentIndex + 1} of {questions.length}
                    </span>
                    <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                      {activeQ.marks} mark{activeQ.marks === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="text-base sm:text-lg font-semibold text-slate-800 leading-relaxed">
                    {activeQ.question}
                  </div>

                  {/* Input Options */}
                  <div className="py-4">
                    {activeQ.question_type === "Multiple Choice" ? (
                      <div className="space-y-3">
                        {(activeQ.options || []).map((opt, oIdx) => (
                          <label
                            key={oIdx}
                            className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors"
                          >
                            <input
                              type="radio"
                              name={`mcq_${activeQ.id}`}
                              value={oIdx}
                              checked={studentAnswers[activeQ.id] === String(oIdx)}
                              onChange={() => handleSelectAnswer(activeQ.id, String(oIdx))}
                              className="w-4 h-4 text-indigo-600 border-slate-300"
                            />
                            <span className="text-sm font-medium text-slate-700">{opt}</span>
                          </label>
                        ))}
                      </div>
                    ) : activeQ.question_type === "True / False" ? (
                      <div className="grid grid-cols-2 gap-4">
                        {(["True", "False"] as const).map((val) => (
                          <label
                            key={val}
                            className="flex items-center justify-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100"
                          >
                            <input
                              type="radio"
                              name={`tf_${activeQ.id}`}
                              value={val}
                              checked={studentAnswers[activeQ.id] === val}
                              onChange={() => handleSelectAnswer(activeQ.id, val)}
                              className="w-4 h-4 text-indigo-600 border-slate-300"
                            />
                            <span className="font-bold text-slate-700">{val}</span>
                          </label>
                        ))}
                      </div>
                    ) : activeQ.question_type === "Fill in the Blank" || activeQ.question_type === "Short Answer" ? (
                      <input
                        type="text"
                        value={studentAnswers[activeQ.id] || ""}
                        onChange={(e) => handleSelectAnswer(activeQ.id, e.target.value)}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-indigo-500"
                        placeholder="Type your answer here..."
                      />
                    ) : (
                      <textarea
                        rows={6}
                        value={studentAnswers[activeQ.id] || ""}
                        onChange={(e) => handleSelectAnswer(activeQ.id, e.target.value)}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-indigo-500"
                        placeholder="Type your full essay response here..."
                      />
                    )}
                  </div>

                  <div className="flex justify-between border-t border-slate-100 pt-4">
                    <button
                      disabled={currentIndex === 0}
                      onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                      className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-colors text-xs flex items-center gap-1 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <div className="flex gap-2">
                      {currentIndex < questions.length - 1 ? (
                        <button
                          onClick={() => setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                          className="px-4 py-2 bg-slate-800 text-white font-semibold rounded-lg hover:bg-slate-900 transition-colors text-xs flex items-center gap-1"
                        >
                          Next
                        </button>
                      ) : (
                        <button
                          onClick={() => handleFinalSubmit(false)}
                          className="px-5 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors text-xs shadow-sm"
                        >
                          Submit Attempt
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. RESULTS VIEW */}
          {view === "results" && reviewSubmission && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Attempt Review</h2>
                  <p className="text-sm text-slate-500 mt-0.5">{reviewSubject}</p>
                </div>
                <button
                  onClick={() => {
                    loadAssessments(studentId, classId);
                    setView("list");
                  }}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-100 transition-colors text-sm"
                >
                  Back to List
                </button>
              </div>

              {/* Summary Stats */}
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Your Score</span>
                  {reviewSubmission.status === "graded" ? (
                    <span className="text-3xl font-extrabold text-indigo-600 block mt-1">
                      {reviewSubmission.total_score}{" "}
                      <span className="text-slate-400 text-sm">/ {reviewSubmission.assessments?.total_marks}</span>
                    </span>
                  ) : (
                    <span className="text-amber-600 font-semibold block mt-2 text-sm">Grading Pending</span>
                  )}
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pass Mark</span>
                  <strong className="text-slate-700 text-xl block mt-2">
                    {reviewSubmission.assessments?.pass_mark} marks
                  </strong>
                </div>

                {reviewSubmission.status === "graded" ? (
                  reviewSubmission.total_score >= reviewSubmission.assessments?.pass_mark ? (
                    <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                      <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block">Outcome</span>
                      <strong className="text-emerald-700 text-lg">PASSED</strong>
                    </div>
                  ) : (
                    <div className="p-3 bg-rose-50 rounded-lg border border-rose-200">
                      <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block">Outcome</span>
                      <strong className="text-rose-700 text-lg">FAILED</strong>
                    </div>
                  )
                ) : (
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Outcome</span>
                    <strong className="text-slate-600 text-base">PENDING</strong>
                  </div>
                )}
              </div>

              {/* Detailed Breakdown */}
              {reviewQuestions.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Detailed Responses</h3>
                  <div className="space-y-4">
                    {reviewQuestions.map((q, idx) => {
                      const ansObj = reviewAnswers.find((x) => x.question_id === q.id);
                      const studentAns = ansObj?.student_answer || "—";
                      const isCorrect = ansObj?.is_correct;

                      let statusClass = "border-slate-200 bg-slate-50/50";
                      let outcomeBadge = (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">
                          UNMARKED
                        </span>
                      );

                      if (isCorrect === true) {
                        statusClass = "border-emerald-200 bg-emerald-50/20";
                        outcomeBadge = (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            CORRECT
                          </span>
                        );
                      } else if (isCorrect === false) {
                        statusClass = "border-rose-200 bg-rose-50/20";
                        outcomeBadge = (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            WRONG
                          </span>
                        );
                      }

                      return (
                        <div key={q.id} className={`p-4 border rounded-xl space-y-3 ${statusClass}`}>
                          <div className="flex justify-between items-start gap-4">
                            <h4 className="font-semibold text-sm text-slate-800">
                              {idx + 1}. {q.question}
                            </h4>
                            <div className="flex items-center gap-2">
                              {outcomeBadge}
                              <span className="text-xs font-bold bg-white border border-slate-200 px-2 py-0.5 rounded">
                                {ansObj?.awarded_marks !== null && ansObj?.awarded_marks !== undefined
                                  ? `${ansObj.awarded_marks} / ${q.marks}`
                                  : `— / ${q.marks}`}{" "}
                                marks
                              </span>
                            </div>
                          </div>

                          <div className="text-xs space-y-1">
                            <div>
                              <span className="text-slate-400 font-bold uppercase">Expected / Reference: </span>
                              <strong className="text-slate-800">
                                {q.question_type === "Multiple Choice" && q.options
                                  ? q.options[Number(q.correct_answer)] || q.correct_answer
                                  : q.correct_answer}
                              </strong>
                            </div>
                            <div>
                              <span className="text-slate-400 font-bold uppercase">Your Selection: </span>
                              <strong className="text-slate-800">
                                {q.question_type === "Multiple Choice" && q.options && studentAns !== "—"
                                  ? q.options[Number(studentAns)] || studentAns
                                  : studentAns}
                              </strong>
                            </div>
                          </div>

                          {q.explanation && (
                            <div className="text-xs text-indigo-600 bg-indigo-50/50 p-2.5 rounded-lg border border-indigo-100">
                              <span className="font-bold">Explanation:</span> {q.explanation}
                            </div>
                          )}
                          {ansObj?.teacher_feedback && (
                            <div className="text-xs text-slate-600 bg-slate-100 p-2.5 rounded-lg border">
                              <span className="font-bold text-slate-700">Teacher Feedback:</span> &quot;
                              {ansObj.teacher_feedback}&quot;
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
