"use client";

import React from "react";
import { getGradeAndRemark } from "@/lib/gradingEngine";
import { scoreOf, type ProgressPoint } from "@/lib/studentInsights";
import type { StudentReport } from "@/lib/reportBuilder";

const gradeColour = (g: string) => (g === "A" || g === "B" ? "bg-emerald-500" : g === "C" ? "bg-sky-500" : g === "D" ? "bg-amber-500" : "bg-rose-500");

/** Every subject as a bar, with a tick for the class average, so strong and weak subjects show at a glance. */
export function SubjectBars({ report }: { report: StudentReport }) {
  const rows = report.subjects
    .map((s) => {
      const score = Math.round(scoreOf(s, report.milestone) * 10) / 10;
      return { name: s.name, score, avg: s.classAverage, grade: getGradeAndRemark(score, report.isSenior).grade };
    })
    .sort((a, b) => b.score - a.score);
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate font-semibold text-slate-700" title={r.name}>
            {r.name}
          </span>
          <div className="relative h-3 rounded-full bg-slate-100">
            <div className={`absolute inset-y-0 left-0 rounded-full ${gradeColour(r.grade)}`} style={{ width: `${Math.max(2, Math.min(100, r.score))}%` }} />
            {r.avg != null && <div className="absolute -top-1 -bottom-1 w-0.5 bg-slate-800" style={{ left: `${Math.min(100, r.avg)}%` }} title={`Class average ${r.avg}`} />}
          </div>
          <span className="tabular-nums text-slate-600 w-24 text-right">
            {r.score}% <span className="font-bold">{r.grade}</span>
          </span>
        </div>
      ))}
      <p className="text-[10px] text-slate-400 pt-1">The dark tick on each bar is the class average. Bars: green is grade A or B, blue C, amber D, red F.</p>
    </div>
  );
}

/** Classwork-and-test average across the progress reports and terminal result, plus the terminal total. */
export function ProgressLine({ points }: { points: ProgressPoint[] }) {
  if (!points.length) return null;
  const W = 320;
  const H = 150;
  const pad = { l: 30, r: 14, t: 12, b: 28 };
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${x(i)},${y(p.coursework)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img" aria-label="Progress across reports">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray={g === 50 ? "4 3" : undefined} />
            <text x={pad.l - 5} y={y(g) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
              {g}
            </text>
          </g>
        ))}
        {points.length > 1 && <polyline points={line} fill="none" stroke="#0f172a" strokeWidth="2" />}
        {points.map((p, i) => (
          <g key={p.milestone}>
            <circle cx={x(i)} cy={y(p.coursework)} r="4" fill="#0f172a" />
            <text x={x(i)} y={y(p.coursework) - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f172a">
              {p.coursework}
            </text>
            {p.overall != null && (
              <g>
                <rect x={x(i) - 4} y={y(p.overall) - 4} width="8" height="8" transform={`rotate(45 ${x(i)} ${y(p.overall)})`} fill="#c9a84c" />
                <text x={x(i) + 9} y={y(p.overall) + 3} fontSize="10" fontWeight="700" fill="#92400e">
                  {p.overall}
                </text>
              </g>
            )}
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="#475569">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="text-[10px] text-slate-400">
        Black dots: your average on classwork, homework, tests and project (comparable across every report). Gold diamond: your overall terminal percentage including the exam. Dashed line: the pass mark area (about 50).
        {points.length === 1 ? " More points appear as the next reports are published." : ""}
      </p>
    </div>
  );
}
