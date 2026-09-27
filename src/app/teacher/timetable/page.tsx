"use client";

import React, { useEffect, useState } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import TimetableGrid, { DAYS, todayNumber } from "@/components/timetable/TimetableGrid";
import MasterTimetableGrid from "@/components/timetable/MasterTimetableGrid";
import { useTimetable } from "@/components/timetable/useTimetable";
import { Skeleton } from "@/components/shared/Skeleton";
import { supabase } from "@/lib/supabase/client";
import { getAcademicSessions } from "@/lib/academicSessions";
import { getAppSettings } from "@/lib/appSettings";
import { printWithTitle } from "@/lib/printTitle";

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

export default function TeacherTimetablePage() {
  const [sessions, setSessions] = useState<string[]>([]);
  const [session, setSession] = useState("");
  const [term, setTerm] = useState("term1");
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [view, setView] = useState("mine"); // "mine" or a class id

  useEffect(() => {
    (async () => {
      const [list, settings] = await Promise.all([getAcademicSessions(), getAppSettings()]);
      setSessions(list.map((s) => s.name));
      setSession(settings?.current_session || list[0]?.name || "");
      if (settings?.current_term) setTerm(settings.current_term);

      const { data: sess } = await supabase.auth.getSession();
      const user = sess?.session?.user;
      if (!user) return;
      const { data: profile } = await supabase.from("users").select("id").eq("auth_id", user.id).maybeSingle();
      const ids = Array.from(new Set([user.id, profile?.id].filter(Boolean))) as string[];
      const [cta, sta] = await Promise.all([
        supabase.from("class_teacher_assignments").select("classes(id, name)").in("teacher_user_id", ids).eq("status", "active"),
        supabase.from("subject_teacher_assignments").select("classes(id, name)").in("teacher_user_id", ids).eq("status", "active"),
      ]);
      const map = new Map<string, { id: string; name: string }>();
      [...(cta.data || []), ...(sta.data || [])].forEach((r: any) => {
        const c = Array.isArray(r.classes) ? r.classes[0] : r.classes;
        if (c?.id) map.set(c.id, c);
      });
      setClasses(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));
    })();
  }, []);

  const query =
    session && view !== "school"
      ? `session=${encodeURIComponent(session)}&term=${term}&${view === "mine" ? "mine=1" : `class_id=${view}`}`
      : null;
  const { data, loading, error } = useTimetable(query);
  const schoolQuery = session && view === "school" ? `session=${encodeURIComponent(session)}&term=${term}&all=1` : null;
  const { data: schoolData, loading: schoolLoading } = useTimetable(schoolQuery);
  const termLabel = TERMS.find((t) => t.value === term)?.label || term;
  const viewLabel = view === "mine" ? "My Timetable" : view === "school" ? "General Timetable" : `${classes.find((c) => c.id === view)?.name || "Class"} Timetable`;

  const today = todayNumber();
  const todays = (data?.slots || [])
    .filter((s) => s.day === today)
    .map((s) => ({ s, p: data?.periods.find((p) => p.id === s.period_id) }))
    .sort((a, b) => (a.p?.position || 0) - (b.p?.position || 0));

  return (
    <AuthGuard allowedRoles={["teacher"]}>
      <div className="timetable-page flex-1 flex flex-col min-h-0 overflow-y-auto">
        <header className="print:hidden bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Timetable</h1>
            <p className="text-sm text-slate-500 mt-1">Your teaching week, or the timetable of a class you teach.</p>
          </div>
          <button
            type="button"
            onClick={() => printWithTitle(`${viewLabel} - ${termLabel} ${session}`)}
            disabled={view === "school" ? !schoolData?.slots.length : !data?.slots.length}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
          >
            Print
          </button>
        </header>
        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full space-y-4 print:p-0">
          <div className="print:hidden flex flex-wrap gap-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              View
              <select value={view} onChange={(e) => setView(e.target.value)} className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal">
                <option value="mine">My teaching week</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="school">Whole school</option>
              </select>
            </label>
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

          <div className="hidden print:block text-center">
            <div className="text-base font-black uppercase">Gracemark Academy — {viewLabel}</div>
            <div className="text-xs">{termLabel} · {session} Academic Session</div>
          </div>

          {view === "mine" && todays.length > 0 && (
            <div className="print:hidden rounded-xl border border-indigo-200 bg-indigo-50 p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Today · {DAYS.find((d) => d.n === today)?.long}</div>
              <ul className="mt-2 space-y-1 text-sm text-indigo-950">
                {todays.map(({ s, p }) => (
                  <li key={s.id} className="flex flex-wrap gap-x-3">
                    <span className="w-28 tabular-nums font-semibold">{p ? `${p.start_time.slice(0, 5)}–${p.end_time.slice(0, 5)}` : ""}</span>
                    <span className="font-bold">{s.subjectName}</span>
                    <span className="text-indigo-700">{s.className}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
          {view === "school" ? (
            schoolLoading && !schoolData ? (
              <div className="space-y-2" role="status" aria-label="Loading timetable">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} block className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <MasterTimetableGrid periods={schoolData?.periods || []} slots={schoolData?.slots || []} loading={schoolLoading} />
            )
          ) : loading && !data ? (
            <div className="space-y-2" role="status" aria-label="Loading timetable">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} block className="h-12 w-full" />
              ))}
            </div>
          ) : data && data.slots.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-12 text-center text-sm text-slate-500">
              No lessons scheduled for {termLabel} {session} yet.
            </div>
          ) : (
            data && <TimetableGrid periods={data.periods} slots={data.slots} showClass={view === "mine"} showTeacher={view !== "mine"} loading={loading} />
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
