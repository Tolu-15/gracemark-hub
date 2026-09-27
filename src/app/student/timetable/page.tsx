"use client";

import React, { useEffect, useState } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import TimetableGrid from "@/components/timetable/TimetableGrid";
import { useTimetable } from "@/components/timetable/useTimetable";
import { Skeleton } from "@/components/shared/Skeleton";
import { getAcademicSessions } from "@/lib/academicSessions";
import { getAppSettings } from "@/lib/appSettings";
import { printWithTitle } from "@/lib/printTitle";

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

export default function StudentTimetablePage() {
  const [sessions, setSessions] = useState<string[]>([]);
  const [session, setSession] = useState("");
  const [term, setTerm] = useState("term1");

  useEffect(() => {
    (async () => {
      const [list, settings] = await Promise.all([getAcademicSessions(), getAppSettings()]);
      setSessions(list.map((s) => s.name));
      setSession(settings?.current_session || list[0]?.name || "");
      if (settings?.current_term) setTerm(settings.current_term);
    })();
  }, []);

  const { data, loading, error } = useTimetable(session ? `session=${encodeURIComponent(session)}&term=${term}` : null);
  const termLabel = TERMS.find((t) => t.value === term)?.label || term;

  return (
    <AuthGuard allowedRoles={["student"]}>
      <div className="timetable-page flex-1 flex flex-col min-h-0 overflow-y-auto">
        <header className="print:hidden bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Class Timetable</h1>
            <p className="text-sm text-slate-500 mt-1">Your weekly lessons.</p>
          </div>
          <button
            type="button"
            onClick={() => printWithTitle(`My Timetable - ${termLabel} ${session}`)}
            disabled={!data?.slots.length}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
          >
            Print
          </button>
        </header>
        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full space-y-4 print:p-0">
          <div className="print:hidden flex flex-wrap gap-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Session
              <select value={session} onChange={(e) => setSession(e.target.value)} className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal">
                {sessions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Term
              <select value={term} onChange={(e) => setTerm(e.target.value)} className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal">
                {TERMS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
          {loading && !data ? (
            <div className="space-y-2" role="status" aria-label="Loading timetable">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} block className="h-12 w-full" />
              ))}
            </div>
          ) : data && data.slots.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-12 text-center text-sm text-slate-500">
              The timetable for {termLabel} {session} has not been published yet.
            </div>
          ) : (
            data && <TimetableGrid periods={data.periods} slots={data.slots} loading={loading} />
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
