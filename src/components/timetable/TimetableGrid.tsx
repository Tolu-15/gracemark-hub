"use client";

import React from "react";

export interface Period {
  id: string;
  position: number;
  label: string;
  start_time: string;
  end_time: string;
  is_break: boolean;
}

export interface Slot {
  id: string;
  class_id: string;
  className: string;
  day: number;
  period_id: string;
  subject_id: string;
  subjectName: string;
  teacher_user_id: string;
  teacherName: string;
  room: string;
  has_clash?: boolean;
}

export const DAYS = [
  { n: 1, short: "Mon", long: "Monday" },
  { n: 2, short: "Tue", long: "Tuesday" },
  { n: 3, short: "Wed", long: "Wednesday" },
  { n: 4, short: "Thu", long: "Thursday" },
  { n: 5, short: "Fri", long: "Friday" },
];

const hhmm = (t: string) => t.slice(0, 5);

/** Monday=1 … Friday=5, weekend → null. */
export function todayNumber(): number | null {
  const d = new Date().getDay();
  return d >= 1 && d <= 5 ? d : null;
}

const HUES = [210, 160, 30, 280, 340, 190, 50, 250, 10, 120];
/** Stable soft colour per subject so a subject looks the same everywhere. */
function tint(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = HUES[h % HUES.length];
  return { background: `hsl(${hue} 70% 96%)`, borderColor: `hsl(${hue} 45% 82%)`, color: `hsl(${hue} 45% 22%)` };
}

/** Small inline spinner; used wherever a timetable is loading or a save/remove is in flight. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px] ${className}`}
    />
  );
}

export default function TimetableGrid({
  periods,
  slots,
  showClass = false,
  showTeacher = true,
  onCellClick,
  emptyLabel = "",
  loading = false,
}: {
  periods: Period[];
  slots: Slot[];
  /** Show the class name in each cell (teacher view). */
  showClass?: boolean;
  /** Show the teacher name in each cell (class views). */
  showTeacher?: boolean;
  /** Admin editor: makes lesson cells clickable. */
  onCellClick?: (day: number, period: Period, slot: Slot | undefined) => void;
  emptyLabel?: string;
  /** Dims the grid and shows a spinner while a refresh is in flight, without unmounting it. */
  loading?: boolean;
}) {
  const today = todayNumber();
  const bySlot = new Map<string, Slot>();
  slots.forEach((s) => bySlot.set(`${s.day}|${s.period_id}`, s));

  return (
    <div className="timetable-print relative overflow-x-auto rounded-xl border border-slate-200 bg-white">
      {loading && (
        <div className="print:hidden absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl bg-white/60 text-xs font-bold text-slate-500">
          <Spinner /> Loading…
        </div>
      )}
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50">
            <th className="w-28 border-b border-r border-slate-200 px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Time
            </th>
            {DAYS.map((d) => (
              <th
                key={d.n}
                className={`border-b border-slate-200 px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider ${
                  today === d.n ? "bg-indigo-50 text-indigo-700" : "text-slate-500"
                }`}
              >
                {d.long}
                {today === d.n && <span className="ml-1 rounded bg-indigo-600 px-1 py-px text-[9px] text-white">Today</span>}
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
                <td colSpan={5} className="bg-slate-50 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">
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
                {DAYS.map((d) => {
                  const slot = bySlot.get(`${d.n}|${p.id}`);
                  const clickable = !!onCellClick;
                  return (
                    <td key={d.n} className={`p-1 align-top ${today === d.n ? "bg-indigo-50/30" : ""}`}>
                      {slot ? (
                        <button
                          type="button"
                          disabled={!clickable}
                          onClick={() => onCellClick?.(d.n, p, slot)}
                          style={slot.has_clash ? undefined : tint(slot.subject_id)}
                          title={slot.has_clash ? `Clash: ${slot.teacherName} is booked in more than one class at this time.` : undefined}
                          className={`block h-full min-h-[44px] w-full rounded-lg border px-2 py-1.5 text-left ${
                            slot.has_clash ? "border-rose-400 bg-rose-50 text-rose-800" : ""
                          } ${clickable ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
                        >
                          <div className="flex items-center gap-1 text-[11px] font-bold leading-tight">
                            {slot.has_clash && <span aria-hidden>⚠</span>}
                            {slot.subjectName}
                          </div>
                          {showClass && <div className="text-[10px] font-semibold opacity-80">{slot.className}</div>}
                          {showTeacher && <div className="text-[10px] opacity-75">{slot.teacherName}</div>}
                          {slot.room && <div className="text-[10px] opacity-60">Room {slot.room}</div>}
                          {slot.has_clash && <div className="text-[10px] font-bold text-rose-600">Clash</div>}
                        </button>
                      ) : clickable ? (
                        <button
                          type="button"
                          onClick={() => onCellClick?.(d.n, p, undefined)}
                          className="block min-h-[44px] w-full rounded-lg border border-dashed border-slate-200 text-[10px] font-semibold text-slate-300 hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-500 cursor-pointer"
                        >
                          + Add
                        </button>
                      ) : (
                        <div className="min-h-[44px] text-center text-[10px] text-slate-300">{emptyLabel}</div>
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
  );
}
