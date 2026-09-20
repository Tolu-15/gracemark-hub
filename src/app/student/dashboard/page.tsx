"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import { normalizeBreakdown, calculateStudentResult, isSeniorClass } from "@/lib/gradingEngine";
import { getAcademicSessions } from "@/lib/academicSessions";
import ResultDashboardApp from "@/components/student/ResultDashboardApp";

interface StudentProfile {
  id: string;
  admission_no: string;
  name: string;
  class_id: string;
  classes?: { id: string; name: string } | null;
}

interface FeeSummary {
  outstandingBalance: number;
  status: "FULLY PAID" | "PARTIALLY PAID" | "UNPAID";
}

export default function StudentDashboardPage() {
  const router = useRouter();
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [session, setSession] = useState("");
  const [sessionsList, setSessionsList] = useState<string[]>([]);
  const [term, setTerm] = useState("term1");
  const [feeSummary, setFeeSummary] = useState<FeeSummary>({
    outstandingBalance: 0,
    status: "FULLY PAID",
  });

  const [results, setResults] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  // Breakdown modal state
  const [activeBreakdown, setActiveBreakdown] = useState<any | null>(null);

  // Overlay Report Dashboard
  const [showFullReport, setShowFullReport] = useState(false);

  // CBT Summaries
  const [upcomingCbt, setUpcomingCbt] = useState<any[]>([]);
  const [recentCbtAttempts, setRecentCbtAttempts] = useState<any[]>([]);

  // 1. Initial Profile & Settings Load
  useEffect(() => {
    async function init() {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push("/");
        return;
      }

      // Fetch or fallback student
      let { data: std } = await supabase
        .from("students")
        .select("id, admission_no, name, class_id, classes(id, name)")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!std) {
        // Fallback check by auth_id
        const { data: stdByAuth } = await supabase
          .from("students")
          .select("id, admission_no, name, class_id, classes(id, name)")
          .eq("id", user.id)
          .maybeSingle();
        std = stdByAuth;
      }

      if (std) {
        setStudent(std as any);
      }

      const [settings, dbSessions] = await Promise.all([
        getAppSettings(),
        getAcademicSessions(),
      ]);
      const names = dbSessions.map((s) => s.name);
      setSessionsList(names);
      const cur = settings?.current_session || (names.length > 0 ? names[0] : "");
      setSession(cur);
      if (settings?.current_term) setTerm(settings.current_term);

      // Fee Summary
      if (std?.id) {
        try {
          const { data: feeStructures } = await supabase
            .from("fee_structures")
            .select("tuition_amount, registration_fee, exams_fee, facilities_fee")
            .eq("class_id", std.class_id)
            .limit(1)
            .maybeSingle();

          const totalFees =
            Number(feeStructures?.tuition_amount || 0) +
            Number(feeStructures?.registration_fee || 0) +
            Number(feeStructures?.exams_fee || 0) +
            Number(feeStructures?.facilities_fee || 0);

          const { data: payments } = await supabase
            .from("fee_payments")
            .select("amount, status")
            .eq("student_id", std.id);

          const totalPaid = (payments || [])
            .filter((p: any) => ["success", "successful"].includes(String(p.status).toLowerCase()))
            .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);

          const balance = Math.max(0, totalFees - totalPaid);
          const feeStatus =
            balance <= 0 && totalFees > 0
              ? "FULLY PAID"
              : totalPaid > 0 && balance > 0
              ? "PARTIALLY PAID"
              : "UNPAID";

          setFeeSummary({
            outstandingBalance: balance,
            status: feeStatus,
          });
        } catch (e) {
          console.warn("Fee fetch error:", e);
        }

        // CBT Assessments
        try {
          const { data: exams } = await supabase
            .from("cbt_exams")
            .select("id, title, duration_minutes, start_time, end_time, total_marks, subjects(name)")
            .eq("class_id", std.class_id)
            .eq("status", "ACTIVE")
            .order("start_time", { ascending: true })
            .limit(5);

          setUpcomingCbt(exams || []);

          const { data: attempts } = await supabase
            .from("cbt_attempts")
            .select("id, score, max_score, created_at, cbt_exams(title, subjects(name))")
            .eq("student_id", std.id)
            .order("created_at", { ascending: false })
            .limit(5);

          setRecentCbtAttempts(attempts || []);
        } catch (e) {
          console.warn("CBT fetch error:", e);
        }
      }
    }

    init();
  }, [router]);

  // 2. Load Approved Results for Active Term/Session
  useEffect(() => {
    if (!student || !student.id) return;
    const studentId = student.id;
    const currentClassName = student.classes?.name || "";
    const isSenior = isSeniorClass(currentClassName);

    async function loadResults() {
      setLoadingResults(true);
      const supabase = getSupabaseBrowserClient();

      try {
        // 1. Check which milestones are published
        let snapQuery = supabase
          .from("published_snapshots")
          .select("report_type")
          .eq("student_id", studentId)
          .eq("term", term);
        if (session) snapQuery = snapQuery.eq("session", session);

        const { data: snaps } = await snapQuery;
        const publishedMilestones: Record<string, boolean> = { pr1: false, pr2: false, pr3: false, tr: false };
        (snaps || []).forEach((s: any) => {
          const type = String(s.report_type || "").toLowerCase();
          if (publishedMilestones[type] !== undefined) publishedMilestones[type] = true;
        });

        // 2. Fetch results for this student
        let rq = supabase
          .from("results")
          .select("id, subject_id, cw, hw, test, project, exam, total, grade, status, pr1_status, pr2_status, pr3_status, tr_status, score_breakdown, subjects(name)")
          .eq("student_id", studentId)
          .eq("term", term);

        if (session) rq = rq.eq("session", session);

        let { data, error } = await rq;

        if (error && /score_breakdown|pr1_status|pr2_status|pr3_status|tr_status/i.test(error.message || "")) {
          let fbQuery = supabase
            .from("results")
            .select("id, subject_id, cw, hw, test, project, exam, total, grade, status, subjects(name)")
            .eq("student_id", studentId)
            .eq("term", term);
          if (session) fbQuery = fbQuery.eq("session", session);
          const fbRes = await fbQuery;
          data = fbRes.data as any;
          error = fbRes.error;
        }

        if (error) throw error;

        // Check if any results rows have explicit published statuses
        (data || []).forEach((r: any) => {
          if (r.pr1_status === "published") publishedMilestones.pr1 = true;
          if (r.pr2_status === "published") publishedMilestones.pr2 = true;
          if (r.pr3_status === "published") publishedMilestones.pr3 = true;
          if (r.tr_status === "published" || r.status === "published") publishedMilestones.tr = true;
        });

        const hasAnyPublished = publishedMilestones.pr1 || publishedMilestones.pr2 || publishedMilestones.pr3 || publishedMilestones.tr;
        const hasApproved = (data || []).some((r: any) => r.status === "approved");

        // Filter results: If milestone gating is used, only show when at least one milestone is published or results are approved
        if (!hasAnyPublished && !hasApproved) {
          setResults([]);
          return;
        }

        // Determine highest published milestone (TR > PR3 > PR2 > PR1)
        const activeMilestone = publishedMilestones.tr || (!hasAnyPublished && hasApproved)
          ? "tr"
          : publishedMilestones.pr3
          ? "pr3"
          : publishedMilestones.pr2
          ? "pr2"
          : "pr1";

        const formatted = (data || [])
          .filter((r: any) => r.status === "approved" || r.status === "published" || r.pr1_status === "published" || r.pr2_status === "published" || r.pr3_status === "published" || r.tr_status === "published")
          .map((r: any) => {
            const raw = normalizeBreakdown(r);
            const computed = calculateStudentResult(raw, undefined, {
              isSenior,
              className: currentClassName,
            });

            if (activeMilestone === "tr") {
              return {
                id: r.id,
                subject: r.subjects?.name || "Subject",
                milestoneLabel: "Terminal Exam",
                cw: r.cw ?? computed.scaled.cw,
                hw: r.hw ?? computed.scaled.hw,
                test: r.test ?? computed.scaled.tests,
                project: r.project ?? computed.scaled.project,
                exam: r.exam ?? computed.scaled.exam,
                total: r.total ?? computed.totalScore,
                grade: r.grade ?? computed.grade,
                remark: computed.remark,
                breakdown: raw,
                isPr: false,
              };
            }

            // For PR milestones, compute PR score
            const prIndex = activeMilestone === "pr1" ? 0 : activeMilestone === "pr2" ? 1 : 2;
            const prCw = Math.min(10, Math.max(0, Number(r.cw ?? computed.scaled.cw)));
            const prHw = Math.min(5, Math.max(0, Number(r.hw ?? computed.scaled.hw)));
            const prTest = Math.min(15, Math.max(0, Number(r.test ?? computed.scaled.tests)));
            const prTotal = +(prCw + prHw + prTest).toFixed(1);
            const prPct = Math.min(100, +((prTotal / 30) * 100).toFixed(1));

            return {
              id: r.id,
              subject: r.subjects?.name || "Subject",
              milestoneLabel: activeMilestone.toUpperCase(),
              cw: prCw,
              hw: prHw,
              test: prTest,
              project: 0,
              exam: 0,
              total: prTotal,
              maxScore: 30,
              percentage: prPct,
              grade: computed.grade,
              remark: computed.remark,
              breakdown: raw,
              isPr: true,
            };
          });

        formatted.sort((a: any, b: any) => a.subject.localeCompare(b.subject));
        setResults(formatted);
      } catch (err: any) {
        console.error("Results load error:", err);
      } finally {
        setLoadingResults(false);
      }
    }

    loadResults();
  }, [student, term, session]);

  const formatCurrency = (amt: number) => {
    return "₦" + Number(amt || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Welcome, {student?.name || "Student"} 👋
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Academic session: <span className="font-semibold text-emerald-700">{session}</span>
          </p>
        </div>
      </header>

      {/* Main Content */}
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full flex-1">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start gap-4">
            <div className="p-3 bg-emerald-50 rounded-lg text-emerald-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-slate-500 mb-1">Admission Number</div>
              <div className="text-xl font-bold text-slate-900">{student?.admission_no || "—"}</div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start gap-4">
            <div className="p-3 bg-teal-50 rounded-lg text-teal-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l9-5-9-5-9 5 9 5z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-slate-500 mb-1">Enrolled Class</div>
              <div className="text-xl font-bold text-slate-900">{student?.classes?.name || "Unassigned"}</div>
            </div>
          </div>

          <div className="bg-slate-900 text-white p-6 rounded-xl border border-slate-800 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-semibold uppercase text-yellow-400">School Fee Status</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    feeSummary.status === "FULLY PAID"
                      ? "bg-emerald-500 text-slate-950"
                      : feeSummary.status === "PARTIALLY PAID"
                      ? "bg-amber-400 text-slate-950"
                      : "bg-rose-500 text-white"
                  }`}
                >
                  {feeSummary.status}
                </span>
              </div>
              <div className="text-2xl font-extrabold text-white mt-1">
                {formatCurrency(feeSummary.outstandingBalance)}
              </div>
              <span className="text-[11px] text-slate-400 block mt-0.5">Outstanding Balance</span>
            </div>
            <Link
              href="/student/school-fees"
              className="mt-4 inline-flex items-center justify-between text-xs font-bold text-yellow-400 hover:text-yellow-300 transition-colors"
            >
              <span>Pay School Fees</span>
              <span>→</span>
            </Link>
          </div>
        </div>

        {/* Results Viewer Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-800">My Approved Results</h3>
            <span className="text-xs px-2.5 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold">
              {results.length} subjects
            </span>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-xs text-slate-500 font-medium">Term</label>
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-indigo-500"
            >
              <option value="term1">1st Term</option>
              <option value="term2">2nd Term</option>
              <option value="term3">3rd Term</option>
            </select>

            <label className="text-xs text-slate-500 font-medium">Session</label>
            <select
              value={session}
              onChange={(e) => setSession(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-indigo-500"
            >
              {sessionsList.length === 0 ? (
                <option value="">No sessions</option>
              ) : (
                sessionsList.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))
              )}
            </select>

            <button
              onClick={() => setShowFullReport(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-indigo-700 transition-colors inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              View Full Report Sheet
            </button>
          </div>
        </div>

        {/* Results Cards Grid */}
        {loadingResults ? (
          <div className="p-8 text-center text-slate-500 bg-white border border-slate-200 rounded-xl shadow-sm">
            Loading your approved results…
          </div>
        ) : results.length === 0 ? (
          <div className="p-12 text-center text-slate-500 bg-white border border-slate-200 rounded-xl shadow-sm">
            <svg className="w-10 h-10 text-slate-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="font-semibold text-slate-700">No approved results found</p>
            <p className="text-xs text-slate-400 mt-1">Results for this term have not been published by administration yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {results.map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-shadow"
              >
                <div>
                  <div className="flex justify-between items-start gap-2 mb-3">
                    <h4 className="font-bold text-slate-900 text-base">{r.subject}</h4>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {r.grade}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-3xl font-black text-slate-900">{r.total}</span>
                    <span className="text-xs text-slate-400 font-semibold">/ {r.isPr ? "30" : "100"}</span>
                    {r.isPr && (
                      <span className="text-xs font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                        {r.percentage}%
                      </span>
                    )}
                    <span className="text-xs font-bold text-slate-500 ml-auto uppercase tracking-wide">
                      {r.remark}
                    </span>
                  </div>

                  {r.isPr ? (
                    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-lg text-center text-xs border border-slate-100 font-mono">
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400">CW (10)</div>
                        <div className="font-bold text-slate-800">{r.cw}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400">HW (5)</div>
                        <div className="font-bold text-slate-800">{r.hw}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400">Test (15)</div>
                        <div className="font-bold text-slate-800">{r.test}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-lg text-center text-xs border border-slate-100">
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400">CA</div>
                        <div className="font-bold text-slate-800">{Math.round(r.cw + r.hw + r.test + r.project)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400">Exam</div>
                        <div className="font-bold text-slate-800">{r.exam}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400">Total</div>
                        <div className="font-bold text-indigo-600">{r.total}</div>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setActiveBreakdown(r)}
                  className="mt-4 w-full py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors text-center"
                >
                  View Score Breakdown
                </button>
              </div>
            ))}
          </div>
        )}

        {/* CBT Assessments Summary */}
        <section className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming CBT Exams */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
              Upcoming CBT Assessments
            </h3>
            <div className="space-y-3 flex-1">
              {upcomingCbt.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No upcoming CBT exams scheduled.</p>
              ) : (
                upcomingCbt.map((exam) => (
                  <div
                    key={exam.id}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{exam.title}</div>
                      <div className="text-[11px] text-slate-500">
                        {exam.subjects?.name} • {exam.duration_minutes} mins • Max {exam.total_marks} pts
                      </div>
                    </div>
                    <Link
                      href="/student/assessments"
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold text-[11px] transition-colors"
                    >
                      Take Exam
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent CBT Attempts */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
              Recent CBT Attempts
            </h3>
            <div className="space-y-3 flex-1">
              {recentCbtAttempts.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No recent exam attempts recorded.</p>
              ) : (
                recentCbtAttempts.map((att) => (
                  <div
                    key={att.id}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{att.cbt_exams?.title}</div>
                      <div className="text-[11px] text-slate-500">
                        {att.cbt_exams?.subjects?.name} •{" "}
                        {new Date(att.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-emerald-600">
                        {att.score} / {att.max_score}
                      </div>
                      <div className="text-[10px] text-slate-400">Score</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Breakdown Modal */}
      {activeBreakdown && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-900">
                Score Breakdown — {activeBreakdown.subject}
              </h3>
              <button
                onClick={() => setActiveBreakdown(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div>
                  <span className="text-slate-500 block">Class Work (Scaled /10):</span>
                  <span className="font-bold text-slate-900 text-sm">{activeBreakdown.cw}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Home Work (Scaled /5):</span>
                  <span className="font-bold text-slate-900 text-sm">{activeBreakdown.hw}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Periodic Tests (Scaled /15):</span>
                  <span className="font-bold text-slate-900 text-sm">{activeBreakdown.test}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Project Work (/5):</span>
                  <span className="font-bold text-slate-900 text-sm">{activeBreakdown.project}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Terminal Exam (/70):</span>
                  <span className="font-bold text-slate-900 text-sm">{activeBreakdown.exam}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Grand Total (/100):</span>
                  <span className="font-bold text-indigo-600 text-base">{activeBreakdown.total}</span>
                </div>
              </div>

              {activeBreakdown.breakdown?.cw?.length > 0 && (
                <div>
                  <h5 className="font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                    Continuous Assessment Items:
                  </h5>
                  <div className="grid grid-cols-5 gap-1.5 text-[11px] font-mono">
                    {activeBreakdown.breakdown.cw.map((v: any, i: number) => (
                      <div key={i} className="bg-slate-100 p-1 rounded text-center">
                        CW{i + 1}: {v !== "" ? v : "—"}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 text-right">
              <button
                onClick={() => setActiveBreakdown(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Report Dashboard Overlay Modal */}
      {showFullReport && student && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
          <ResultDashboardApp
            student={student}
            initialTerm={term}
            initialSession={session}
            onClose={() => setShowFullReport(false)}
          />
        </div>
      )}
    </div>
  );
}
