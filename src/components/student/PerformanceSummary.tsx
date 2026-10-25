"use client";

import React, { useMemo } from "react";
import type { Milestone, StudentReport } from "@/lib/reportBuilder";
import { buildInsights, progressSeries, type Tone } from "@/lib/studentInsights";
import { ProgressLine, SubjectBars } from "./ProgressCharts";

const BANNER: Record<Tone, string> = {
  good: "bg-emerald-50 border-emerald-200 text-emerald-900",
  neutral: "bg-slate-50 border-slate-200 text-slate-800",
  warn: "bg-amber-50 border-amber-200 text-amber-900",
  bad: "bg-rose-50 border-rose-200 text-rose-900",
};
const DOT: Record<Tone, string> = { good: "bg-emerald-500", neutral: "bg-slate-400", warn: "bg-amber-500", bad: "bg-rose-500" };

interface Props {
  report: StudentReport;
  /** The nearest earlier report in the same term, for "since last time". */
  previous?: StudentReport | null;
  /** Every report the viewer may see for this term, for the progress line. */
  reports: Partial<Record<Milestone, StudentReport | null>>;
}

/**
 * The written summary of one report (strong and weak subjects, position, attendance, personal skills and
 * what to do next) plus the subject and progress charts. Everything comes from numbers already on the
 * report the student is looking at; nothing is shown for a Terminal Result that has not been opened.
 */
export default function PerformanceSummary({ report, previous, reports }: Props) {
  const insights = useMemo(() => buildInsights(report, previous), [report, previous]);
  const series = useMemo(() => progressSeries({ ...reports, [report.milestone]: report }), [reports, report]);

  return (
    <section className="no-print print:hidden space-y-4" aria-label="Performance summary">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-slate-900">Performance summary</h3>
        <span className="text-[11px] text-slate-400">
          {report.milestoneLabel} · {report.termLabel} {report.session}
        </span>
      </div>

      <div className={`p-4 rounded-2xl border text-sm font-semibold ${BANNER[insights.headline.tone]}`}>{insights.headline.text}</div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Subjects against the class</h4>
          <SubjectBars report={report} />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Progress this term</h4>
          <ProgressLine points={series} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {insights.sections.map((s) => (
          <div key={s.id} className={`rounded-2xl border border-slate-200 bg-white p-4 ${s.id === "next" ? "lg:col-span-2" : ""}`}>
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              <span className={`w-2 h-2 rounded-full ${DOT[s.tone]}`} />
              {s.title}
            </h4>
            <ul className="space-y-2 text-sm text-slate-700 leading-relaxed">
              {s.items.map((item, i) => (
                <li key={i} className="pl-3 border-l-2 border-slate-200">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">
        This summary is written automatically from the published marks, attendance and personal-skill scores. It reports the numbers as they are. Please discuss it with your class teacher.
      </p>
    </section>
  );
}
