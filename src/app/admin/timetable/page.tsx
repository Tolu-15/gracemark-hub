"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import TimetableGrid, { DAYS, Period, Slot, Spinner } from "@/components/timetable/TimetableGrid";
import MasterTimetableGrid from "@/components/timetable/MasterTimetableGrid";
import { useTimetable } from "@/components/timetable/useTimetable";
import { Skeleton } from "@/components/shared/Skeleton";
import { getAuthHeaders, supabase } from "@/lib/supabase/client";
import { getAcademicSessions } from "@/lib/academicSessions";
import { getAppSettings } from "@/lib/appSettings";
import { printWithTitle } from "@/lib/printTitle";

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

interface Option {
  subject_id: string;
  subject_name: string;
  periods_per_week: number;
  teacher_user_id: string;
  teacher_name: string;
  scheduled: number;
}

export default function AdminTimetablePage() {
  const [sessions, setSessions] = useState<string[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [session, setSession] = useState("");
  const [term, setTerm] = useState("term1");
  const [classId, setClassId] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [allSlots, setAllSlots] = useState<Slot[]>([]);
  const [editing, setEditing] = useState<{ day: number; period: Period; slot?: Slot } | null>(null);
  const [showPeriods, setShowPeriods] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [view, setView] = useState<"class" | "school">("class");
  const [sideLoading, setSideLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const [list, settings, { data: cl }] = await Promise.all([
        getAcademicSessions(),
        getAppSettings(),
        supabase.from("classes").select("id, name").order("name"),
      ]);
      setSessions(list.map((s) => s.name));
      setSession(settings?.current_session || list[0]?.name || "");
      if (settings?.current_term) setTerm(settings.current_term);
      setClasses(cl || []);
      if (cl?.length) setClassId(cl[0].id);
    })();
  }, []);

  const query = session && classId ? `session=${encodeURIComponent(session)}&term=${term}&class_id=${classId}` : null;
  const { data, loading, error, reload } = useTimetable(query);

  const loadSide = useCallback(async () => {
    if (!session || !classId) return;
    setSideLoading(true);
    try {
      const headers = await getAuthHeaders();
      const [o, a] = await Promise.all([
        fetch(`/api/timetable/options?session=${encodeURIComponent(session)}&term=${term}&class_id=${classId}`, { headers }).then((r) => r.json()),
        fetch(`/api/timetable?session=${encodeURIComponent(session)}&term=${term}&all=1`, { headers }).then((r) => r.json()),
      ]);
      setOptions(o.ok ? o.options : []);
      setAllSlots(a.ok ? a.slots : []);
    } finally {
      setSideLoading(false);
    }
  }, [session, term, classId]);

  useEffect(() => {
    loadSide();
  }, [loadSide]);

  const refresh = async () => {
    await Promise.all([reload(), loadSide()]);
  };

  const className = classes.find((c) => c.id === classId)?.name || "";
  const termLabel = TERMS.find((t) => t.value === term)?.label || term;
  const periods = data?.periods || [];
  const slots = data?.slots || [];

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="timetable-page flex-1 flex flex-col min-h-0 overflow-y-auto">
        <header className="print:hidden bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Timetable</h1>
            <p className="text-sm text-slate-500 mt-1">One timetable per class, per term. A teacher double-booked at the same time is still saved, but flagged red so it can be fixed.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowPeriods(true)} className="px-3.5 py-2 border border-slate-300 bg-white rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
              School-day periods
            </button>
            <button type="button" onClick={() => setShowCopy(true)} className="px-3.5 py-2 border border-slate-300 bg-white rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
              Copy from another term
            </button>
            <button
              type="button"
              onClick={() => printWithTitle(view === "school" ? `General Timetable - ${termLabel} ${session}` : `Timetable - ${className} - ${termLabel} ${session}`)}
              disabled={view === "school" ? !allSlots.length : !slots.length}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
            >
              Print
            </button>
          </div>
        </header>

        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-5 print:p-0">
          <div className="print:hidden flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <Sel label="Session" value={session} onChange={setSession} options={sessions.map((s) => ({ value: s, label: s }))} />
              <Sel label="Term" value={term} onChange={setTerm} options={TERMS} />
              {view === "class" && (
                <Sel label="Class" value={classId} onChange={setClassId} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
              )}
            </div>
            <div className="flex gap-1.5 rounded-lg border border-slate-300 bg-white p-1">
              <button
                type="button"
                onClick={() => setView("class")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer ${view === "class" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                Class view
              </button>
              <button
                type="button"
                onClick={() => setView("school")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer ${view === "school" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                Whole school
              </button>
            </div>
          </div>

          <div className="hidden print:block text-center">
            <div className="text-base font-black uppercase">Gracemark Academy — {view === "class" ? `${className} Timetable` : "General Timetable"}</div>
            <div className="text-xs">{termLabel} · {session} Academic Session</div>
          </div>

          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

          {view === "school" ? (
            <MasterTimetableGrid periods={periods} slots={allSlots} loading={sideLoading} />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1fr_260px] print:block">
              <div>
                {loading && !data ? (
                  <div className="space-y-2" role="status" aria-label="Loading timetable">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} block className="h-12 w-full" />
                    ))}
                  </div>
                ) : (
                  <TimetableGrid
                    periods={periods}
                    slots={slots}
                    loading={loading}
                    onCellClick={(day, period, slot) => setEditing({ day, period, slot })}
                  />
                )}
              </div>

              <aside className="print:hidden space-y-3">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Periods this week</h3>
                  {options.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">
                      No subject teachers are assigned to {className || "this class"} in {session}. Assign them under Manage Teachers first.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2.5">
                      {options.map((o) => {
                        const target = o.periods_per_week;
                        const over = target > 0 && o.scheduled > target;
                        const done = target > 0 && o.scheduled === target;
                        return (
                          <li key={`${o.subject_id}:${o.teacher_user_id}`} className="text-xs">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-slate-800">{o.subject_name}</span>
                              <span className={`tabular-nums font-bold ${over ? "text-rose-600" : done ? "text-emerald-600" : "text-slate-500"}`}>
                                {o.scheduled}
                                {target > 0 ? ` / ${target}` : ""}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400">{o.teacher_name}</div>
                            {target > 0 && (
                              <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                                <div className={`h-full ${over ? "bg-rose-500" : done ? "bg-emerald-500" : "bg-indigo-400"}`} style={{ width: `${Math.min(100, (o.scheduled / target) * 100)}%` }} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </aside>
            </div>
          )}
        </div>

        {editing && (
          <CellModal
            key={`${editing.day}-${editing.period.id}`}
            cell={editing}
            options={options}
            allSlots={allSlots}
            classId={classId}
            session={session}
            term={term}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await refresh();
            }}
          />
        )}
        {showPeriods && (
          <PeriodsModal
            periods={periods}
            onClose={() => setShowPeriods(false)}
            onSaved={async () => {
              setShowPeriods(false);
              await refresh();
            }}
          />
        )}
        {showCopy && (
          <CopyModal
            sessions={sessions}
            toSession={session}
            toTerm={term}
            classId={classId}
            className={className}
            onClose={() => setShowCopy(false)}
            onDone={async () => {
              setShowCopy(false);
              await refresh();
            }}
          />
        )}
      </div>
    </AuthGuard>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 normal-case tracking-normal">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="print:hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-sm font-bold cursor-pointer" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CellModal({
  cell,
  options,
  allSlots,
  classId,
  session,
  term,
  onClose,
  onSaved,
}: {
  cell: { day: number; period: Period; slot?: Slot };
  options: Option[];
  allSlots: Slot[];
  classId: string;
  session: string;
  term: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // "clear", or the option key currently being saved — lets each control show its own spinner
  // while everything else in the modal is disabled.
  const [action, setAction] = useState<string | null>(null);
  const busy = action !== null;
  const [error, setError] = useState("");

  // Teachers already booked in another class at this day/period.
  const busyTeachers = useMemo(() => {
    const m = new Map<string, string>();
    allSlots
      .filter((s) => s.day === cell.day && s.period_id === cell.period.id && s.class_id !== classId)
      .forEach((s) => m.set(s.teacher_user_id, `${s.subjectName} in ${s.className}`));
    return m;
  }, [allSlots, cell, classId]);

  async function choose(o: Option) {
    setAction(`${o.subject_id}:${o.teacher_user_id}`);
    setError("");
    try {
      const res = await fetch("/api/timetable/slot", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ session, term, class_id: classId, day: cell.day, period_id: cell.period.id, subject_id: o.subject_id, teacher_user_id: o.teacher_user_id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not save.");
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setAction(null);
    }
  }

  async function clear() {
    if (!cell.slot) return;
    setAction("clear");
    setError("");
    const res = await fetch(`/api/timetable/slot?id=${cell.slot.id}`, { method: "DELETE", headers: await getAuthHeaders() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      setError(json.error || "Could not remove.");
      setAction(null);
      return;
    }
    onSaved();
  }

  const dayName = DAYS.find((d) => d.n === cell.day)?.long;
  return (
    <Modal title={`${dayName} · ${cell.period.label}`} onClose={onClose}>
      <p className="text-xs text-slate-500">
        Only teachers assigned to this class this session are listed. Picking one already teaching another class at this time still saves — it's flagged red as a clash so it can be fixed later.
      </p>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {options.length === 0 ? (
        <p className="text-sm text-slate-500">No subject teachers are assigned to this class in {session}.</p>
      ) : (
        <ul className="space-y-2">
          {options.map((o) => {
            const clash = busyTeachers.get(o.teacher_user_id);
            const current = cell.slot?.subject_id === o.subject_id && cell.slot?.teacher_user_id === o.teacher_user_id;
            const key = `${o.subject_id}:${o.teacher_user_id}`;
            const saving = action === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose(o)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${busy ? "cursor-not-allowed" : "cursor-pointer"} ${
                    clash ? "border-rose-300 bg-rose-50 hover:border-rose-400" : current ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold text-slate-900">
                      {o.subject_name}
                      {saving && <Spinner className="ml-2 text-slate-400" />}
                    </span>
                    <span className="text-[11px] tabular-nums text-slate-400">
                      {o.scheduled}
                      {o.periods_per_week ? `/${o.periods_per_week}` : ""} this week
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">{o.teacher_name}</div>
                  {clash && <div className="mt-1 text-[11px] font-semibold text-rose-600">⚠ Clash: also teaching {clash} at this time</div>}
                  {saving && <div className="mt-1 text-[11px] font-semibold text-slate-400">Saving…</div>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {cell.slot && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={clear}
            className={`inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:text-rose-800 disabled:opacity-60 ${busy ? "cursor-not-allowed" : "cursor-pointer"}`}
          >
            {action === "clear" && <Spinner />}
            {action === "clear" ? "Removing…" : "Remove this lesson"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function PeriodsModal({ periods, onClose, onSaved }: { periods: Period[]; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState(() => periods.map((p) => ({ ...p, start_time: p.start_time.slice(0, 5), end_time: p.end_time.slice(0, 5) })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (i: number, patch: Partial<Period>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/timetable/periods", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ periods: rows }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not save.");
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="School-day periods" onClose={onClose}>
      <p className="text-xs text-slate-500">
        These times apply to every class and term. Removing a period also removes any lessons scheduled in it.
      </p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.id || i} className="grid grid-cols-[1fr_88px_88px_auto_auto] items-center gap-2">
            <input value={r.label} onChange={(e) => update(i, { label: e.target.value })} className="px-2 py-1.5 border border-slate-300 rounded-md text-sm" aria-label="Name" />
            <input type="time" value={r.start_time} onChange={(e) => update(i, { start_time: e.target.value })} className="px-1.5 py-1.5 border border-slate-300 rounded-md text-xs" aria-label="Start" />
            <input type="time" value={r.end_time} onChange={(e) => update(i, { end_time: e.target.value })} className="px-1.5 py-1.5 border border-slate-300 rounded-md text-xs" aria-label="End" />
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              <input type="checkbox" checked={r.is_break} onChange={(e) => update(i, { is_break: e.target.checked })} />
              Break
            </label>
            <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="text-rose-500 hover:text-rose-700 text-sm cursor-pointer" aria-label="Remove">
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          const last = rows[rows.length - 1];
          setRows((r) => [...r, { id: "", position: r.length + 1, label: `Period ${r.filter((x) => !x.is_break).length + 1}`, start_time: last?.end_time || "08:00", end_time: last?.end_time ? addMinutes(last.end_time, 40) : "08:40", is_break: false }]);
        }}
        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
      >
        + Add period
      </button>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 cursor-pointer">
          Cancel
        </button>
        <button type="button" onClick={save} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold disabled:opacity-60 cursor-pointer">
          {saving ? "Saving…" : "Save periods"}
        </button>
      </div>
    </Modal>
  );
}

function addMinutes(hhmm: string, mins: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + mins);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function CopyModal({
  sessions,
  toSession,
  toTerm,
  classId,
  className,
  onClose,
  onDone,
}: {
  sessions: string[];
  toSession: string;
  toTerm: string;
  classId: string;
  className: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fromSession, setFromSession] = useState(toSession);
  const [fromTerm, setFromTerm] = useState(toTerm === "term1" ? "term3" : toTerm === "term2" ? "term1" : "term2");
  const [scope, setScope] = useState<"class" | "all">("class");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function copy() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/timetable/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ from_session: fromSession, from_term: fromTerm, to_session: toSession, to_term: toTerm, class_id: scope === "class" ? classId : undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not copy.");
      setMsg(json.message);
      setTimeout(onDone, 1400);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Copy a timetable" onClose={onClose}>
      <p className="text-xs text-slate-500">
        Copies into <strong>{TERMS.find((t) => t.value === toTerm)?.label} {toSession}</strong>. Lessons are only copied where the same teacher is still assigned to the class and subject, and nobody is double-booked.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Sel label="From session" value={fromSession} onChange={setFromSession} options={sessions.map((s) => ({ value: s, label: s }))} />
        <Sel label="From term" value={fromTerm} onChange={setFromTerm} options={TERMS} />
      </div>
      <div className="space-y-1.5 text-sm text-slate-700">
        <label className="flex items-center gap-2">
          <input type="radio" checked={scope === "class"} onChange={() => setScope("class")} /> Only {className || "this class"}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> Every class
        </label>
      </div>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 cursor-pointer">
          Cancel
        </button>
        <button type="button" onClick={copy} disabled={busy} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold disabled:opacity-60 cursor-pointer">
          {busy ? "Copying…" : "Copy timetable"}
        </button>
      </div>
    </Modal>
  );
}
