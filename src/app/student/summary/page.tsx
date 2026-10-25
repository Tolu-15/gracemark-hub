"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";
import { PageLoader, InlineSpinner } from "@/components/shared/PageLoader";
import { printWithTitle } from "@/lib/printTitle";
import TerminalResultGate, { type TrInfo } from "@/components/student/TerminalResultGate";
import PerformanceSummary from "@/components/student/PerformanceSummary";
import { getOpenedTr, openedTrKey, rememberOpenedTr } from "@/lib/openedTrCache";
import type { Milestone, StudentReport } from "@/lib/reportBuilder";

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];
const TABS: { key: Milestone; label: string }[] = [
  { key: "PR1", label: "PR 1" },
  { key: "PR2", label: "PR 2" },
  { key: "PR3", label: "PR 3" },
  { key: "TR", label: "Terminal" },
];

interface ReportResponse {
  student: { id: string; name: string; admissionNo: string; className: string };
  sessions: string[];
  session: string;
  term: string;
  reports: Record<Milestone, StudentReport | null>;
  tr?: TrInfo | null;
}

/**
 * The student's Performance Summary: a written breakdown of one published report (strong and weak
 * subjects, position, attendance, personal skills, what to do next) with charts. It lives on its own page,
 * apart from the report sheet that gets printed. Progress-report summaries are free; the Terminal summary
 * is built from the Terminal Result, so it needs a scratch card view like the result itself, and the view
 * is shared with the Results page for the rest of the visit.
 */
export default function StudentSummaryPage() {
  const [session, setSession] = useState("");
  const [term, setTerm] = useState("");
  const [data, setData] = useState<ReportResponse | null>(null);
  const [tab, setTab] = useState<Milestone | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0); // re-render after a Terminal Result is opened
  const seq = React.useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (session) params.set("session", session);
      if (term) params.set("term", term);
      const res = await fetch(`/api/student/report?${params.toString()}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load your results.");
      if (seq.current !== mine) return;
      setData(json);
      if (!session) setSession(json.session);
      if (!term) setTerm(json.term);
      const available = TABS.map((t) => t.key).filter((k) => json.reports[k] || (k === "TR" && json.tr?.published));
      setTab((prev) => (prev && available.includes(prev) ? prev : available[available.length - 1] || null));
    } catch (e: any) {
      if (seq.current === mine) setError(e.message);
    } finally {
      if (seq.current === mine) setLoading(false);
    }
  }, [session, term]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) return <PageLoader label="Loading your summary…" />;
  if (!data) {
    return (
      <div className="max-w-xl mx-auto p-6 rounded-2xl border border-rose-200 bg-rose-50 text-center">
        <p className="text-sm font-semibold text-rose-700">{error || "Could not load your results."}</p>
        <button type="button" onClick={load} className="mt-3 px-4 py-2 bg-white border border-rose-200 rounded-lg text-xs font-bold text-rose-700 cursor-pointer">
          Try again
        </button>
      </div>
    );
  }

  const trPublished = Boolean(data.tr?.published);
  const available = TABS.filter((t) => data.reports[t.key] || (t.key === "TR" && trPublished));
  const termLabel = TERMS.find((t) => t.value === term)?.label || "";
  const key = openedTrKey(data.student.id, data.session, data.term);
  const opened = getOpenedTr(key);

  // What this student may see right now: progress reports always; the Terminal Result only once opened.
  const reports: Partial<Record<Milestone, StudentReport | null>> = { ...data.reports, TR: opened ? (opened.report as StudentReport) : null };
  const order: Milestone[] = ["PR1", "PR2", "PR3", "TR"];
  const current = tab ? reports[tab] || null : null;
  const previous = tab
    ? order
        .slice(0, order.indexOf(tab))
        .reverse()
        .map((k) => reports[k])
        .find(Boolean) || null
    : null;

  return (
    <div className="rd-root max-w-5xl mx-auto space-y-5">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Performance Summary</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {data.student.name} · {data.student.className}. A written breakdown of each published report: where marks were lost, where you are stronger, your position, attendance, personal skills, and what to do next.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Session
            <select value={session} onChange={(e) => setSession(e.target.value)} className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 normal-case tracking-normal">
              {(data.sessions.length ? data.sessions : [session]).filter(Boolean).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Term
            <select value={term} onChange={(e) => setTerm(e.target.value)} className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 normal-case tracking-normal">
              {TERMS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {loading && <InlineSpinner label="Updating…" className="mb-2" />}
        </div>
      </div>

      {available.length === 0 ? (
        <div className="py-16 px-6 text-center rounded-2xl border border-slate-200 bg-slate-50">
          <p className="text-base font-bold text-slate-900">Nothing to summarise yet</p>
          <p className="text-sm text-slate-500 mt-1">
            The school has not published any {termLabel} {data.session} results yet. Your summary appears here as soon as a report is released.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <div role="tablist" aria-label="Report" className="inline-flex rounded-xl bg-slate-100 p-1">
              {available.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${tab === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {current && (
              <button
                type="button"
                onClick={() => printWithTitle(`${data.student.name} - Performance Summary - ${current.milestoneLabel} - ${termLabel} ${data.session}`)}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                Print summary
              </button>
            )}
          </div>

          {tab === "TR" && !current && data.tr ? (
            <div className="space-y-3 print:hidden">
              <div className="max-w-xl mx-auto p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-900">
                The terminal summary is written from your Terminal Result, so it needs the same scratch card as the result. Opening it uses one view, and the Results page can then show the same result without using another view while this page stays open.
              </div>
              <TerminalResultGate
                session={data.session}
                term={data.term}
                termLabel={termLabel}
                studentName={data.student.name}
                tr={data.tr}
                onOpened={(report, card) => {
                  rememberOpenedTr(key, { report, card });
                  bump((n) => n + 1);
                }}
                onRefresh={load}
              />
            </div>
          ) : current ? (
            <PerformanceSummary report={current} previous={previous} reports={reports} />
          ) : null}
        </>
      )}
    </div>
  );
}
