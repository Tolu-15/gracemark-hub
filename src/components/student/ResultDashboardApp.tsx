"use client";

import React, { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  fetchStudentReport,
  TERM_OPTIONS,
  PR_INTERVALS,
  termLabel,
} from "@/lib/studentReport";
import { getAcademicSessions } from "@/lib/academicSessions";

interface ResultDashboardAppProps {
  student: {
    id: string;
    admission_no: string;
    name: string;
    class_id?: string;
    classes?: { name: string } | null;
  };
  initialTerm?: string;
  initialSession?: string;
  onClose?: () => void;
}

function scoreColour(total: any) {
  const n = Number(total);
  if (!Number.isFinite(n)) return "";
  if (n >= 70) return "rd-score-excellent";
  if (n >= 55) return "rd-score-good";
  if (n >= 45) return "rd-score-average";
  if (n >= 40) return "rd-score-poor";
  return "rd-score-fail";
}

function GradeBadge({ grade }: { grade?: string | null }) {
  const g = String(grade || "—").toUpperCase();
  let badgeClass = "rd-badge-f";
  if (g.startsWith("A")) badgeClass = "rd-badge-a";
  else if (g.startsWith("B")) badgeClass = "rd-badge-b";
  else if (g.startsWith("C")) badgeClass = "rd-badge-c";
  else if (g.startsWith("D")) badgeClass = "rd-badge-d";
  else if (g.startsWith("E")) badgeClass = "rd-badge-e";
  else if (g === "F" || g === "F9") badgeClass = "rd-badge-f";

  return <span className={`rd-badge-grade ${badgeClass}`}>{g}</span>;
}

function StatCard({
  label,
  value,
  sub,
  accent = "violet",
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: "emerald" | "amber" | "blue" | "violet";
}) {
  const accentMap = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  };
  const color = accentMap[accent] || accentMap.violet;

  return (
    <div className={`rd-stat-card rounded-xl p-4 flex flex-col justify-between border-2 ${color}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
      </div>
      <div className="mt-1">
        <p className="text-2xl sm:text-3xl font-black tracking-tight">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function ResultDashboardApp({
  student,
  initialTerm = "term1",
  initialSession = "",
  onClose,
}: ResultDashboardAppProps) {
  const [term, setTerm] = useState(initialTerm);
  const [session, setSession] = useState(initialSession);
  const [sessionsList, setSessionsList] = useState<string[]>([]);
  const [tab, setTab] = useState<"all" | "pr1" | "pr2" | "pr3" | "tr">("all");
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSessions() {
      try {
        const list = await getAcademicSessions();
        const names = list.map((s) => s.name);
        setSessionsList(names);
        if (!initialSession && names.length > 0) {
          setSession((prev) => prev || names[0]);
        }
      } catch (e) {
        console.warn("Could not load sessions in ResultDashboardApp", e);
      }
    }
    loadSessions();
  }, [initialSession]);

  const loadReport = useCallback(async () => {
    if (!student?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStudentReport({ student, term, session });
      setReport(data);
    } catch (err: any) {
      console.error("Report fetch error:", err);
      setError(err.message || "Failed to load academic report sheet.");
    } finally {
      setLoading(false);
    }
  }, [student, term, session]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-8">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium text-slate-500 animate-pulse">Loading academic report sheet...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-8 text-center max-w-lg mx-auto bg-white rounded-xl border border-rose-200 shadow-sm my-8">
        <div className="text-rose-600 font-semibold mb-3">{error || "No report available."}</div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={loadReport}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Retry
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rd-root bg-white text-slate-900 print:p-0">
      <div className="rd-inner max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
        {/* Actions Bar (hidden in print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Term</label>
              <select
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="rd-select text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-lg"
              >
                {TERM_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Session</label>
              <select
                value={session}
                onChange={(e) => setSession(e.target.value)}
                className="rd-select text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-lg"
              >
                {sessionsList.length === 0 ? (
                  <option value={session || ""}>{session || "No session"}</option>
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

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50 text-xs font-semibold">
              <button
                onClick={() => setTab("all")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  tab === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setTab("pr1")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  tab === "pr1" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                PR 1
              </button>
              <button
                onClick={() => setTab("pr2")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  tab === "pr2" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                PR 2
              </button>
              <button
                onClick={() => setTab("pr3")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  tab === "pr3" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                PR 3
              </button>
              <button
                onClick={() => setTab("tr")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  tab === "tr" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Terminal
              </button>
            </div>

            <button
              onClick={handlePrint}
              className="rd-btn-print inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print Report Sheet
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="px-3 py-2 text-slate-500 hover:text-slate-800 rounded-lg text-xs font-semibold transition-colors"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* Official Header for Print & Display */}
        <div className="rd-header text-center border-b-2 border-slate-900 pb-4 mb-6">
          <div className="flex items-center justify-center gap-4 mb-2">
            <img src="/assets/icons/logo.jpg" alt="Gracemark Academy" className="w-16 h-16 rounded-xl object-cover shadow-sm" />
            <div>
              <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-slate-900 font-serif">
                Gracemark Academy
              </h1>
              <p className="text-xs font-bold tracking-widest text-amber-700 uppercase">
                Excellence • Integrity • Innovation
              </p>
              <p className="text-[11px] text-slate-500">Official Terminal Academic Performance Report</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl text-left border border-slate-200 mt-4 text-xs">
            <div>
              <span className="block text-[10px] font-bold uppercase text-slate-400">Student Name</span>
              <span className="font-bold text-slate-900">{report.studentName}</span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase text-slate-400">Admission No</span>
              <span className="font-mono font-bold text-slate-800">{report.admissionNo}</span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase text-slate-400">Class</span>
              <span className="font-bold text-slate-800">{report.className}</span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase text-slate-400">Academic Period</span>
              <span className="font-bold text-slate-800">{report.termLabel} — {report.session}</span>
            </div>
          </div>
        </div>

        {/* Promotion Banner (if 3rd Term) */}
        {report.promotion && (
          <div
            className={`rd-promotion-banner rounded-xl p-4 mb-6 border-2 flex flex-wrap items-center justify-between gap-4 ${
              report.promotion.code === "success"
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : report.promotion.code === "warning"
                ? "bg-amber-50 border-amber-300 text-amber-900"
                : "bg-rose-50 border-rose-300 text-rose-900"
            }`}
          >
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Annual Promotion Status</div>
              <div className="text-lg font-black">{report.promotion.text}</div>
            </div>
            <span
              className={`px-3 py-1 rounded-lg text-xs font-extrabold uppercase ${
                report.promotion.code === "success"
                  ? "bg-emerald-600 text-white"
                  : report.promotion.code === "warning"
                  ? "bg-amber-500 text-white"
                  : "bg-rose-600 text-white"
              }`}
            >
              {report.promotion.status}
            </span>
          </div>
        )}

        {/* Performance Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Overall Average"
            value={`${report.percentage}%`}
            sub={`${report.overallTotal} Marks Total`}
            accent="emerald"
          />
          <StatCard
            label="Class Position"
            value={report.position && report.classSize ? `${report.position} / ${report.classSize}` : "—"}
            sub={report.classSize ? `Class Size: ${report.classSize}` : "Rank uncalculated"}
            accent="violet"
          />
          <StatCard
            label="Evaluated Subjects"
            value={report.subjects.length}
            sub="Approved records"
            accent="blue"
          />
          <StatCard
            label="Attendance Rate"
            value={`${report.attendancePct}%`}
            sub={`${report.attendance.daysPresent} of ${report.attendance.daysOpened} Days`}
            accent="amber"
          />
        </div>

        {/* Academic Marks Table */}
        <div className="rd-table-section mb-6 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="rd-table-wrap overflow-x-auto">
            <table className="rd-table w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white font-bold uppercase tracking-wider">
                  <th className="p-3 border border-slate-700">Subject</th>
                  {(tab === "all" || tab === "tr") && (
                    <>
                      <th className="p-2 text-center border border-slate-700">CW (10)</th>
                      <th className="p-2 text-center border border-slate-700">HW (5)</th>
                      <th className="p-2 text-center border border-slate-700">Test (15)</th>
                      <th className="p-2 text-center border border-slate-700">Proj (5)</th>
                      <th className="p-2 text-center border border-slate-700">Exam (70)</th>
                      <th className="p-2 text-center border border-slate-700">Total (100)</th>
                      {report.term === "term3" && (
                        <th className="p-2 text-center border border-slate-700">Annual Avg</th>
                      )}
                      <th className="p-2 text-center border border-slate-700">Grade</th>
                      <th className="p-2 text-center border border-slate-700">Remark</th>
                      <th className="p-2 text-center border border-slate-700">Class Avg</th>
                      <th className="p-2 text-center border border-slate-700">High</th>
                      <th className="p-2 text-center border border-slate-700">Low</th>
                    </>
                  )}
                  {tab === "pr1" && (
                    <>
                      <th className="p-2 text-center border border-slate-700">CW (10)</th>
                      <th className="p-2 text-center border border-slate-700">HW (5)</th>
                      <th className="p-2 text-center border border-slate-700">Test 1 (15)</th>
                      <th className="p-2 text-center border border-slate-700">Total CA (30)</th>
                      <th className="p-2 text-center border border-slate-700">Score (%)</th>
                      <th className="p-2 text-center border border-slate-700">Grade</th>
                      <th className="p-2 text-center border border-slate-700">Status</th>
                    </>
                  )}
                  {tab === "pr2" && (
                    <>
                      <th className="p-2 text-center border border-slate-700">CW (10)</th>
                      <th className="p-2 text-center border border-slate-700">HW (5)</th>
                      <th className="p-2 text-center border border-slate-700">Test 2 (15)</th>
                      <th className="p-2 text-center border border-slate-700">Total CA (30)</th>
                      <th className="p-2 text-center border border-slate-700">Score (%)</th>
                      <th className="p-2 text-center border border-slate-700">Grade</th>
                      <th className="p-2 text-center border border-slate-700">Status</th>
                    </>
                  )}
                  {tab === "pr3" && (
                    <>
                      <th className="p-2 text-center border border-slate-700">CW (10)</th>
                      <th className="p-2 text-center border border-slate-700">HW (5)</th>
                      <th className="p-2 text-center border border-slate-700">Test 3 (15)</th>
                      <th className="p-2 text-center border border-slate-700">Total CA (30)</th>
                      <th className="p-2 text-center border border-slate-700">Score (%)</th>
                      <th className="p-2 text-center border border-slate-700">Grade</th>
                      <th className="p-2 text-center border border-slate-700">Status</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {report.subjects.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="p-6 text-center text-slate-500">
                      No approved scores found for this period.
                    </td>
                  </tr>
                ) : (
                  report.subjects.map((s: any) => (
                    <tr key={s.subjectId} className="hover:bg-slate-50 border-b border-slate-200">
                      <td className="p-3 font-semibold text-slate-900 border-r border-slate-200">{s.subject}</td>
                      {(tab === "all" || tab === "tr") && (
                        <>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.cw}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.hw}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.test}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.project}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.exam}</td>
                          <td className={`p-2 text-center border-r border-slate-200 font-bold font-mono ${scoreColour(s.total)}`}>
                            {s.total}
                          </td>
                          {report.term === "term3" && (
                            <td className="p-2 text-center border-r border-slate-200 font-mono font-bold text-indigo-700">
                              {s.annualAverage ?? "—"}
                            </td>
                          )}
                          <td className="p-2 text-center border-r border-slate-200">
                            <GradeBadge grade={s.grade} />
                          </td>
                          <td className="p-2 text-center border-r border-slate-200 text-[11px] font-semibold text-slate-600">
                            {s.remark}
                          </td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono text-slate-500">{s.classAverage}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono text-emerald-600 font-semibold">{s.high}</td>
                          <td className="p-2 text-center font-mono text-rose-500 font-semibold">{s.low}</td>
                        </>
                      )}
                      {tab === "pr1" && (
                        <>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr1.cw}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr1.hw}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr1.test}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-bold font-mono text-indigo-700">
                            {s.prs.pr1.totalCa}
                          </td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr1.percentage}%</td>
                          <td className="p-2 text-center border-r border-slate-200">
                            <GradeBadge grade={s.prs.pr1.grade} />
                          </td>
                          <td className="p-2 text-center text-[11px] font-semibold text-slate-600">{s.prs.pr1.status}</td>
                        </>
                      )}
                      {tab === "pr2" && (
                        <>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr2.cw}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr2.hw}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr2.test}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-bold font-mono text-indigo-700">
                            {s.prs.pr2.totalCa}
                          </td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr2.percentage}%</td>
                          <td className="p-2 text-center border-r border-slate-200">
                            <GradeBadge grade={s.prs.pr2.grade} />
                          </td>
                          <td className="p-2 text-center text-[11px] font-semibold text-slate-600">{s.prs.pr2.status}</td>
                        </>
                      )}
                      {tab === "pr3" && (
                        <>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr3.cw}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr3.hw}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr3.test}</td>
                          <td className="p-2 text-center border-r border-slate-200 font-bold font-mono text-indigo-700">
                            {s.prs.pr3.totalCa}
                          </td>
                          <td className="p-2 text-center border-r border-slate-200 font-mono">{s.prs.pr3.percentage}%</td>
                          <td className="p-2 text-center border-r border-slate-200">
                            <GradeBadge grade={s.prs.pr3.grade} />
                          </td>
                          <td className="p-2 text-center text-[11px] font-semibold text-slate-600">{s.prs.pr3.status}</td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Behavioral Traits & Psychomotor Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Behavioral &amp; Affective Development (1–5)
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: "Punctuality", val: report.evaluations?.punctuality ?? 4 },
                { label: "Neatness", val: report.evaluations?.neatness ?? 4 },
                { label: "Honesty", val: report.evaluations?.honesty ?? 5 },
                { label: "Politeness", val: report.evaluations?.politeness ?? 4 },
                { label: "Cooperation", val: report.evaluations?.cooperation ?? 4 },
                { label: "Leadership", val: report.evaluations?.leadership ?? 3 },
              ].map((t) => (
                <div key={t.label} className="flex justify-between items-center py-1 border-b border-slate-200">
                  <span className="text-slate-600">{t.label}</span>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((num) => (
                      <span
                        key={num}
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          num <= Number(t.val) ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-400"
                        }`}
                      >
                        {num}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Psychomotor &amp; Applied Skills (1–5)
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: "Handwriting", val: report.evaluations?.handwriting ?? 4 },
                { label: "Sports & Games", val: report.evaluations?.sports ?? 4 },
                { label: "Crafts & Projects", val: report.evaluations?.crafts ?? 3 },
                { label: "Music & Performing", val: report.evaluations?.music ?? 4 },
              ].map((t) => (
                <div key={t.label} className="flex justify-between items-center py-1 border-b border-slate-200">
                  <span className="text-slate-600">{t.label}</span>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((num) => (
                      <span
                        key={num}
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          num <= Number(t.val) ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-400"
                        }`}
                      >
                        {num}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Remarks and Signatures */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-400">Class Teacher's Remark</div>
              <p className="text-xs font-medium text-slate-800 italic mt-1 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                "{report.teacherRemark}"
              </p>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-400">Principal's Official Remark</div>
              <p className="text-xs font-bold text-slate-900 mt-1 bg-amber-50/50 p-2.5 rounded-lg border border-amber-200/50">
                "{report.principalRemark}"
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col justify-between">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Next Term Resumes</span>
                <span className="text-xs font-black text-slate-800">{report.resumptionDate}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block text-right">Principal's Stamp</span>
                <div className="mt-1 h-14 w-28 relative flex items-center justify-center">
                  <img
                    src={report.principalSignatureUrl}
                    alt="Signature"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 text-center border-t border-slate-100 pt-2 mt-4">
              Generated by Gracemark Academy Educational Hub • Official Document
            </div>
          </div>
        </div>

        {/* AI Insight Box */}
        <div className="rd-ai-box p-4 rounded-xl mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              AI Academic Insight &amp; Pedagogical Analysis
            </span>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">{report.aiInsight}</p>
        </div>
      </div>
    </div>
  );
}
