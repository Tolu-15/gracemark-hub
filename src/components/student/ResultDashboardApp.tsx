"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";
import ReportSheet from "@/components/results/ReportSheet";

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

const MILESTONE_TABS = [
  { key: "PR1", label: "PR 1", hint: "Weeks 1–4" },
  { key: "PR2", label: "PR 2", hint: "Weeks 1–6" },
  { key: "PR3", label: "PR 3", hint: "Weeks 1–10" },
  { key: "TR", label: "Terminal", hint: "End of term" },
] as const;

type MilestoneKey = (typeof MILESTONE_TABS)[number]["key"];

interface ResultDashboardAppProps {
  /** The logged-in student (student portal). */
  student?: { id: string } | null;
  /** Admin view of a specific student's published results. */
  studentId?: string;
  initialTerm?: string;
  initialSession?: string;
  onClose?: () => void;
}

interface ReportResponse {
  student: { id: string; name: string; admissionNo: string; className: string };
  sessions: string[];
  session: string;
  term: string;
  reports: Record<MilestoneKey, any | null>;
  availableTerms: Record<string, string[]>;
}

export default function ResultDashboardApp({ studentId, initialTerm, initialSession, onClose }: ResultDashboardAppProps) {
  const [term, setTerm] = useState(initialTerm || "");
  const [session, setSession] = useState(initialSession || "");
  const [data, setData] = useState<ReportResponse | null>(null);
  const [tab, setTab] = useState<MilestoneKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (session) params.set("session", session);
      if (term) params.set("term", term);
      if (studentId) params.set("student_id", studentId);
      const res = await fetch(`/api/student/report?${params.toString()}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load results.");
      setData(json);
      if (!session) setSession(json.session);
      if (!term) setTerm(json.term);

      // Open the latest published milestone
      const published = MILESTONE_TABS.map((m) => m.key).filter((k) => json.reports[k]);
      setTab((prev) => (prev && published.includes(prev) ? prev : published[published.length - 1] || null));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session, term, studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const published = data ? MILESTONE_TABS.filter((m) => data.reports[m.key]) : [];
  const current = tab && data ? data.reports[tab] : null;
  const termLabel = TERMS.find((t) => t.value === term)?.label || "";

  return (
    <div className="rd-root max-w-5xl mx-auto p-3 sm:p-6 print:p-0 space-y-4">
      {/* Controls (hidden when printing) */}
      <div className="no-print print:hidden flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Session
            <select
              value={session}
              onChange={(e) => {
                setSession(e.target.value);
                setTab(null);
              }}
              className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 normal-case tracking-normal"
            >
              {(data?.sessions.length ? data.sessions : [session]).filter(Boolean).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Term
            <select
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setTab(null);
              }}
              className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 normal-case tracking-normal"
            >
              {TERMS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                  {data?.availableTerms?.[t.value]?.length ? " •" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {published.length > 0 && (
            <div role="tablist" aria-label="Report" className="inline-flex rounded-xl bg-slate-100 p-1">
              {published.map((m) => (
                <button
                  key={m.key}
                  role="tab"
                  aria-selected={tab === m.key}
                  type="button"
                  onClick={() => setTab(m.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    tab === m.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  }`}
                  title={m.hint}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!current}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
          >
            Print
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer">
              Close
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-sm text-slate-500">Loading results…</div>
      ) : error ? (
        <div className="p-6 text-center rounded-2xl border border-rose-200 bg-rose-50">
          <p className="text-sm font-semibold text-rose-700">{error}</p>
          <button type="button" onClick={load} className="mt-3 px-4 py-2 bg-white border border-rose-200 rounded-lg text-xs font-bold text-rose-700 cursor-pointer">
            Try again
          </button>
        </div>
      ) : !current ? (
        <div className="py-16 px-6 text-center rounded-2xl border border-slate-200 bg-slate-50">
          <p className="text-base font-bold text-slate-900">No results released yet</p>
          <p className="text-sm text-slate-500 mt-1">
            The school has not published any {termLabel} {session} results{data?.student.name ? ` for ${data.student.name}` : ""}. Please check back later.
          </p>
        </div>
      ) : (
        <ReportSheet report={current} />
      )}
    </div>
  );
}
