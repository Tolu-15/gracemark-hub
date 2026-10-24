"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient, getAuthHeaders } from "@/lib/supabase/client";
import { resolveStudentUserIdCandidates } from "@/lib/auth";
import { getAppSettings } from "@/lib/appSettings";
import { getStudentCurrentInvoice, formatPaymentStatus } from "@/lib/schoolFinance";
import { PAYMENTS_ENABLED } from "@/lib/features";
import { getAcademicSessions } from "@/lib/academicSessions";
import { Skeleton, SkeletonValue } from "@/components/shared/Skeleton";
import ResultDashboardApp from "@/components/student/ResultDashboardApp";
import AnnouncementsPreview from "@/components/announcements/AnnouncementsPreview";

interface StudentProfile {
  id: string;
  admission_no: string;
  name: string;
  class_id: string;
  classes?: { id: string; name: string } | null;
  guardian_email?: string | null;
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

  // Latest published (frozen) report for the selected term
  // `tr` is set when the latest release is the Terminal Result: students only get that after a
  // scratch card view, so the card shows its status instead of the report itself.
  const [latest, setLatest] = useState<{ milestone: string; report: any; count: number; tr?: any } | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);

  // Overlay Report Dashboard
  const [showFullReport, setShowFullReport] = useState(false);

  // CBT Summaries
  const [upcomingCbt, setUpcomingCbt] = useState<any[]>([]);
  const [recentCbtAttempts, setRecentCbtAttempts] = useState<any[]>([]);

  // Guardian email prompt — nudges the student to add a parent/guardian
  // email (used for result-publish notifications) if none is on file yet.
  const [showGuardianPrompt, setShowGuardianPrompt] = useState(false);
  const [guardianEmailInput, setGuardianEmailInput] = useState("");
  const [guardianSaving, setGuardianSaving] = useState(false);
  const [guardianError, setGuardianError] = useState("");

  // 1. Initial Profile & Settings Load
  useEffect(() => {
    async function init() {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push("/");
        return;
      }

      // Fetch student profile, tolerant of both user_id storage conventions
      const candidateIds = await resolveStudentUserIdCandidates(user.id);
      let { data: std } = await supabase
        .from("students")
        .select("id, admission_no, name, class_id, guardian_email, classes:class_id(id, name)")
        .in("user_id", candidateIds)
        .maybeSingle();

      if (std) {
        setStudent(std as any);
        if (!std.guardian_email) {
          const dismissed = typeof window !== "undefined" && localStorage.getItem(`gma_guardian_email_dismissed_${std.id}`);
          if (!dismissed) setShowGuardianPrompt(true);
        }
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
          const fin = PAYMENTS_ENABLED ? await getStudentCurrentInvoice(std.id) : null;
          if (fin) {
            setFeeSummary({
              outstandingBalance: fin.outstandingBalance,
              status: formatPaymentStatus(fin.status) as any,
            });
          }
        } catch (e) {
          console.warn("Fee fetch error:", e);
        }

        // CBT Assessments
        try {
          const { data: exams } = await supabase
            .from("cbt_exams")
            .select("id, title, duration_minutes, pass_mark, subjects(name)")
            .eq("class_id", std.class_id)
            .eq("is_published", true)
            .order("created_at", { ascending: false })
            .limit(5);

          setUpcomingCbt(exams || []);

          const { data: attempts } = await supabase
            .from("cbt_submissions")
            .select("id, total_score, submitted_at, cbt_exams(title, subjects(name))")
            .eq("student_id", std.id)
            .in("status", ["submitted", "graded"])
            .order("submitted_at", { ascending: false })
            .limit(5);

          setRecentCbtAttempts(
            (attempts || []).map((a: any) => ({ ...a, score: a.total_score, created_at: a.submitted_at }))
          );
        } catch (e) {
          console.warn("CBT fetch error:", e);
        }
      }
    }

    init();
  }, [router]);

  // 2. Latest published report for the selected term/session
  useEffect(() => {
    if (!student?.id || !session) return;
    let cancelled = false;
    (async () => {
      setLoadingResults(true);
      try {
        const res = await fetch(
          `/api/student/report?session=${encodeURIComponent(session)}&term=${encodeURIComponent(term)}`,
          { headers: await getAuthHeaders() }
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setLatest(null);
          return;
        }
        const order = ["PR1", "PR2", "PR3"];
        const published = order.filter((k) => json.reports[k]);
        if (json.tr?.published) {
          // The Terminal Result is withheld from this response; it opens through the scratch card gate.
          setLatest({ milestone: "TR", report: null, count: published.length + 1, tr: json.tr });
          return;
        }
        const key = published[published.length - 1];
        setLatest(key ? { milestone: key, report: json.reports[key], count: published.length } : null);
      } catch (err) {
        console.error("Results load error:", err);
        if (!cancelled) setLatest(null);
      } finally {
        if (!cancelled) setLoadingResults(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [student, term, session]);

  const formatCurrency = (amt: number) => {
    return "₦" + Number(amt || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });
  };

  function dismissGuardianPrompt() {
    if (student?.id && typeof window !== "undefined") {
      localStorage.setItem(`gma_guardian_email_dismissed_${student.id}`, "1");
    }
    setShowGuardianPrompt(false);
  }

  async function saveGuardianEmail(e: React.FormEvent) {
    e.preventDefault();
    setGuardianError("");
    const email = guardianEmailInput.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setGuardianError("Please enter a valid email address.");
      return;
    }
    setGuardianSaving(true);
    try {
      const res = await fetch("/api/student/guardian-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ guardian_email: email }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to save email.");
      setStudent((prev) => (prev ? { ...prev, guardian_email: email } : prev));
      setShowGuardianPrompt(false);
    } catch (err: any) {
      setGuardianError(err.message || "Failed to save email. Please try again.");
    } finally {
      setGuardianSaving(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto print:overflow-visible">
      {/* Header */}
      <header className={`bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 shrink-0 ${showFullReport ? "print:hidden" : ""}`}>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Welcome, {student ? student.name : <Skeleton className="h-6 w-44 align-middle" />}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Academic session:{" "}
            <SkeletonValue loading={!session} className="h-4 w-20"><span className="font-semibold text-emerald-700">{session}</span></SkeletonValue>
          </p>
        </div>
      </header>

      {/* Main Content */}
      <div className={`p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full flex-1 ${showFullReport ? "print:hidden" : ""}`}>
        <AnnouncementsPreview role="student" />

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
              <div className="text-xl font-bold text-slate-900"><SkeletonValue loading={!student} className="h-6 w-32">{student?.admission_no || "—"}</SkeletonValue></div>
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
              <div className="text-xl font-bold text-slate-900"><SkeletonValue loading={!student} className="h-6 w-24">{student?.classes?.name || "Unassigned"}</SkeletonValue></div>
            </div>
          </div>

          {!PAYMENTS_ENABLED ? (
            <div className="bg-slate-900 text-white p-6 rounded-xl border border-slate-800 shadow-sm flex flex-col justify-between opacity-90">
              <div>
                <span className="text-xs font-semibold uppercase text-yellow-400">School Fees</span>
                <div className="text-lg font-extrabold text-white mt-2">Not available</div>
                <span className="text-[11px] text-slate-400 block mt-0.5">Online fee payment is not available at the moment.</span>
              </div>
              <span className="mt-4 inline-flex text-xs font-bold text-slate-500 cursor-not-allowed" aria-disabled="true">
                Pay School Fees (not available)
              </span>
            </div>
          ) : (
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
          )}
        </div>

        {/* Results */}
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 mb-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">My Results</h3>
              <p className="text-xs text-slate-500">Only results released by the school appear here.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                aria-label="Term"
              >
                <option value="term1">1st Term</option>
                <option value="term2">2nd Term</option>
                <option value="term3">3rd Term</option>
              </select>
              <select
                value={session}
                onChange={(e) => setSession(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                aria-label="Session"
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
            </div>
          </div>

          {loadingResults ? (
            <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
              <div className="space-y-2">
                <Skeleton block className="h-3 w-24" />
                <Skeleton block className="h-5 w-48" />
                <Skeleton block className="h-3 w-32" />
              </div>
              <Skeleton className="h-10 w-32 rounded-lg" />
            </div>
          ) : !latest ? (
            <div className="py-8 text-center">
              <p className="font-bold text-slate-900">No results released yet</p>
              <p className="text-xs text-slate-500 mt-1">Progress reports and the terminal result appear here once the school publishes them.</p>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Latest release</div>
                <div className="text-base font-bold text-slate-900">
                  {latest.milestone === "TR" ? "Terminal Result" : latest.report.milestoneLabel}
                </div>
                {latest.tr ? (
                  <div className="text-xs text-slate-500">
                    {latest.tr.card?.status === "active"
                      ? `Scratch card active · ${latest.tr.card.viewsLeft} of ${latest.tr.card.viewsAllowed} views left`
                      : latest.tr.card?.status === "issued"
                        ? "Your scratch card is ready: enter its PIN to activate it"
                        : latest.tr.card?.status === "exhausted"
                          ? "All views on your scratch card are used. A new card is needed to view it again"
                          : `Ready to view with a scratch card (₦${Number(latest.tr.price ?? 1000).toLocaleString("en-NG")})`}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    {latest.report.subjects?.length || 0} subjects · Overall {latest.report.summary?.percentage}% ({latest.report.summary?.remark})
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowFullReport(true)}
                className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                {latest.tr ? "Open terminal result" : "View report sheet"}
              </button>
            </div>
          )}
        </section>

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
                        {exam.subjects?.name} • {exam.duration_minutes} mins • Pass mark {exam.pass_mark}
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
                        {att.score ?? "—"}
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

      {/* Guardian Email Prompt */}
      {showGuardianPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-slate-900">Add a parent/guardian email?</h3>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              We'll email your parent or guardian whenever a new result is published, so they stay in the loop. This is optional and you can add it later from your profile.
            </p>
            <form onSubmit={saveGuardianEmail} className="mt-4 space-y-3">
              <input
                type="email"
                required
                value={guardianEmailInput}
                onChange={(e) => setGuardianEmailInput(e.target.value)}
                placeholder="parent@example.com"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              {guardianError && <p className="text-xs text-rose-600 font-medium">{guardianError}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={guardianSaving}
                  className="flex-1 px-4 py-2.5 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  {guardianSaving ? "Saving…" : "Save Email"}
                </button>
                <button
                  type="button"
                  onClick={dismissGuardianPrompt}
                  className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                  Not now
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Report Dashboard Overlay Modal */}
      {showFullReport && student && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-white print:static print:overflow-visible">
          <ResultDashboardApp
            initialTerm={term}
            initialSession={session}
            onClose={() => setShowFullReport(false)}
          />
        </div>
      )}
    </div>
  );
}
