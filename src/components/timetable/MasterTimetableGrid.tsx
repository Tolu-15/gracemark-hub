"use client";

import React, { useMemo, useState } from "react";
import { DAYS, Spinner, todayNumber, type Period, type Slot } from "./TimetableGrid";

const hhmm = (t: string) => t.slice(0, 5);

/**
 * Whole-school view: one day at a time, classes across the top, periods down the side. Used by
 * the admin and teacher "general timetable" so everyone can see the full school schedule (and
 * any teacher clashes, in red) in one place, rather than one class at a time.
 */
export default function MasterTimetableGrid({ periods, slots, loading = false }: { periods: Period[]; slots: Slot[]; loading?: boolean }) {
  const [day, setDay] = useState(todayNumber() || 1);

  const classes = useMemo(() => {
    const m = new Map<string, string>();
    slots.forEach((s) => m.set(s.class_id, s.className));
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [slots]);

  const bySlot = useMemo(() => {
    const m = new Map<string, Slot>();
    slots.filter((s) => s.day === day).forEach((s) => m.set(`${s.class_id}|${s.period_id}`, s));
    return m;
  }, [slots, day]);

  const clashCount = slots.filter((s) => s.day === day && s.has_clash).length;

  if (!classes.length) {
    return (
      <div className="relative bg-white border border-slate-200 rounded-xl px-4 py-12 text-center text-sm text-slate-500">
        {loading ? (
          <span className="inline-flex items-center gap-2 font-bold text-slate-500">
            <Spinner /> Loading…
          </span>
        ) : (
          "No lessons scheduled yet."
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="print:hidden flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => (
            <button
              key={d.n}
              type="button"
              onClick={() => setDay(d.n)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                day === d.n ? "bg-indigo-600 text-white" : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {d.short}
            </button>
          ))}
        </div>
        {clashCount > 0 && (
          <span className="text-[11px] font-bold text-rose-600">
            ⚠ {clashCount} clash{clashCount > 1 ? "es" : ""} on {DAYS.find((d) => d.n === day)?.long}
          </span>
        )}
      </div>

      <div className="hidden print:block text-center text-xs font-bold">{DAYS.find((d) => d.n === day)?.long}</div>

      <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {loading && (
          <div className="print:hidden absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl bg-white/60 text-xs font-bold text-slate-500">
            <Spinner /> Loading…
          </div>
        )}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="w-24 border-b border-r border-slate-200 px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Time
              </th>
              {classes.map((c) => (
                <th key={c.id} className="min-w-[110px] border-b border-slate-200 px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) =>
              p.is_break ? (
                <tr key={p.id}>
                  <td className="border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-semibold text-slate-500">
                    {hhmm(p.start_time)}–{hhmm(p.end_time)}
                  </td>
                  <td colSpan={classes.length} className="bg-slate-50 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">
                    {p.label}
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="border-r border-slate-200 px-2 py-2 align-top">
                    <div className="text-[11px] font-bold text-slate-700">{p.label}</div>
                    <div className="text-[10px] text-slate-400 tabular-nums">
                      {hhmm(p.start_time)}–{hhmm(p.end_time)}
                    </div>
                  </td>
                  {classes.map((c) => {
                    const slot = bySlot.get(`${c.id}|${p.id}`);
                    return (
                      <td key={c.id} className="p-1 align-top">
                        {slot ? (
                          <div
                            title={slot.has_clash ? `Clash: ${slot.teacherName} is booked in more than one class at this time.` : undefined}
                            className={`min-h-[44px] rounded-lg border px-2 py-1.5 ${
                              slot.has_clash ? "border-rose-400 bg-rose-50 text-rose-800" : "border-slate-200 bg-slate-50/60 text-slate-700"
                            }`}
                          >
                            <div className="flex items-center gap-1 text-[11px] font-bold leading-tight">
                              {slot.has_clash && <span aria-hidden>⚠</span>}
                              {slot.subjectName}
                            </div>
                            <div className="text-[10px] opacity-75">{slot.teacherName}</div>
                            {slot.has_clash && <div className="text-[10px] font-bold text-rose-600">Clash</div>}
                          </div>
                        ) : (
                          <div className="min-h-[44px]" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
