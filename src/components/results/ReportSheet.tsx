"use client";

import React from "react";
import type { StudentReport, SubjectLine } from "@/lib/reportBuilder";
import { JUNIOR_GRADE_BANDS, SENIOR_GRADE_BANDS } from "@/lib/gradingEngine";

type Report = StudentReport & { publishedAt?: string };

const fmt = (n: number | null | undefined, dp = 1) =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(dp).replace(/\.0+$/, "");

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function gradeTone(grade: string) {
  switch (grade) {
    case "A":
      return "text-emerald-700";
    case "B":
      return "text-sky-700";
    case "C":
      return "text-slate-800";
    case "D":
      return "text-amber-700";
    default:
      return "text-rose-700";
  }
}

function formatDate(d: string | null) {
  if (!d) return null;
  const date = new Date(`${d}T00:00:00`);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 border-b border-slate-300 ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-2 border-b border-slate-100 tabular-nums ${className}`}>{children}</td>;
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rs-stat rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-black text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function PRTable({ report }: { report: Report }) {
  const isPR3 = report.milestone === "PR3";
  const testMax = isPR3 ? 10 : 15;
  return (
    <>
      {/* Phones: one card per subject */}
      <div className="md:hidden print:hidden space-y-2">
        {report.subjects.map((s) => (
          <div key={s.subjectId} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-sm text-slate-900">{s.name}</div>
              <div className={`text-sm font-black ${gradeTone(s.grade)}`}>{s.grade}</div>
            </div>
            <div className={`grid ${isPR3 ? "grid-cols-5" : "grid-cols-4"} gap-1 mt-2 text-center text-xs`}>
              <div><div className="text-[9px] font-bold text-slate-400">CW /10</div>{fmt(s.cw)}</div>
              <div><div className="text-[9px] font-bold text-slate-400">HW /5</div>{fmt(s.hw)}</div>
              <div><div className="text-[9px] font-bold text-slate-400">TEST /{testMax}</div>{fmt(s.test)}</div>
              {isPR3 && <div><div className="text-[9px] font-bold text-slate-400">PROJ /5</div>{fmt(s.project)}</div>}
              <div><div className="text-[9px] font-bold text-slate-400">CA /30</div><span className="font-bold">{fmt(s.total)}</span></div>
            </div>
            <div className="flex justify-between text-xs mt-2 pt-2 border-t border-slate-100">
              <span className="text-slate-500">{s.remark}</span>
              <span className="font-bold text-slate-900">{fmt(s.percentage)}%</span>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block print:block overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <Th className="text-left w-8">#</Th>
              <Th className="text-left">Subject</Th>
              <Th className="text-center">Class Work<br />10</Th>
              <Th className="text-center">Home Work<br />5</Th>
              <Th className="text-center">Test<br />{testMax}</Th>
              {isPR3 && <Th className="text-center">Project<br />5</Th>}
              <Th className="text-center">Total CA<br />30</Th>
              <Th className="text-center">%</Th>
              <Th className="text-center">Grade</Th>
              <Th className="text-left">Remark</Th>
            </tr>
          </thead>
          <tbody>
            {report.subjects.map((s, i) => (
              <tr key={s.subjectId}>
                <Td className="text-slate-400">{i + 1}</Td>
                <Td className="font-semibold text-slate-900">{s.name}</Td>
                <Td className="text-center">{fmt(s.cw)}</Td>
                <Td className="text-center">{fmt(s.hw)}</Td>
                <Td className="text-center">{fmt(s.test)}</Td>
                {isPR3 && <Td className="text-center">{fmt(s.project)}</Td>}
                <Td className="text-center font-bold">{fmt(s.total)}</Td>
                <Td className="text-center">{fmt(s.percentage)}</Td>
                <Td className={`text-center font-black ${gradeTone(s.grade)}`}>{s.grade}</Td>
                <Td className="text-slate-600">{s.remark}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TRTable({ report }: { report: Report }) {
  const third = report.term === "term3";
  const value = (s: SubjectLine) => (third ? s.annualAverage : s.total);
  return (
    <>
      <div className="md:hidden print:hidden space-y-2">
        {report.subjects.map((s) => (
          <div key={s.subjectId} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-sm text-slate-900">{s.name}</div>
                <div className="text-[11px] text-slate-500">{s.remark}</div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-black ${gradeTone(s.grade)}`}>{s.grade}</div>
                <div className="text-sm font-bold text-slate-900">{fmt(value(s))}</div>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1 mt-2 text-center text-xs">
              <div><div className="text-[9px] font-bold text-slate-400">CW /10</div>{fmt(s.cw)}</div>
              <div><div className="text-[9px] font-bold text-slate-400">HW /5</div>{fmt(s.hw)}</div>
              <div><div className="text-[9px] font-bold text-slate-400">TEST /10</div>{fmt(s.test)}</div>
              <div><div className="text-[9px] font-bold text-slate-400">PROJ /5</div>{fmt(s.project)}</div>
              <div><div className="text-[9px] font-bold text-slate-400">EXAM /70</div>{fmt(s.exam)}</div>
            </div>
            {third && (
              <div className="grid grid-cols-3 gap-1 mt-2 text-center text-xs">
                <div><div className="text-[9px] font-bold text-slate-400">1ST TERM</div>{fmt(s.term1)}</div>
                <div><div className="text-[9px] font-bold text-slate-400">2ND TERM</div>{fmt(s.term2)}</div>
                <div><div className="text-[9px] font-bold text-slate-400">3RD TERM</div>{fmt(s.total)}</div>
              </div>
            )}
            <div className="flex justify-between text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-100">
              <span>Class avg {fmt(s.classAverage)}</span>
              <span>Low {fmt(s.lowest)} · High {fmt(s.highest)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block print:block overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <Th className="text-left">Subject</Th>
              {third && <Th className="text-center">1st Term<br />100</Th>}
              {third && <Th className="text-center">2nd Term<br />100</Th>}
              <Th className="text-center">Class Work<br />10</Th>
              <Th className="text-center">Home Work<br />5</Th>
              <Th className="text-center">Test<br />10</Th>
              <Th className="text-center">Project<br />5</Th>
              <Th className="text-center">Exam<br />70</Th>
              <Th className="text-center">Total<br />100</Th>
              {third && <Th className="text-center">Annual<br />Average</Th>}
              <Th className="text-center">Class<br />Avg</Th>
              <Th className="text-center">Lowest</Th>
              <Th className="text-center">Highest</Th>
              <Th className="text-center">Grade</Th>
              <Th className="text-left">Remark</Th>
              <Th className="text-center">Credit<br />Unit</Th>
            </tr>
          </thead>
          <tbody>
            {report.subjects.map((s) => (
              <tr key={s.subjectId}>
                <Td className="font-semibold text-slate-900">{s.name}</Td>
                {third && <Td className="text-center">{fmt(s.term1)}</Td>}
                {third && <Td className="text-center">{fmt(s.term2)}</Td>}
                <Td className="text-center">{fmt(s.cw)}</Td>
                <Td className="text-center">{fmt(s.hw)}</Td>
                <Td className="text-center">{fmt(s.test)}</Td>
                <Td className="text-center">{fmt(s.project)}</Td>
                <Td className="text-center">{fmt(s.exam)}</Td>
                <Td className="text-center font-bold">{fmt(s.total)}</Td>
                {third && <Td className="text-center font-bold">{fmt(s.annualAverage)}</Td>}
                <Td className="text-center text-slate-500">{fmt(s.classAverage)}</Td>
                <Td className="text-center text-slate-500">{fmt(s.lowest)}</Td>
                <Td className="text-center text-slate-500">{fmt(s.highest)}</Td>
                <Td className={`text-center font-black ${gradeTone(s.grade)}`}>{s.grade}</Td>
                <Td className="text-slate-600">{s.remark}</Td>
                <Td className="text-center text-slate-500">{fmt(s.creditUnit)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ReportSheet({ report }: { report: Report }) {
  const isTR = report.milestone === "TR";
  const bands = report.isSenior ? SENIOR_GRADE_BANDS : JUNIOR_GRADE_BANDS;
  const heading = `${report.termLabel} ${report.session} Academic Session`.toUpperCase();

  return (
    <article className="report-sheet bg-white text-slate-900 rounded-2xl border border-slate-200 print:border-0 print:rounded-none p-4 sm:p-6 print:p-0 space-y-5">
      {/* School header */}
      <header className="rs-header flex items-center gap-4 border-b-2 border-slate-900 pb-4">
        <img src="/assets/icons/logo.jpg" alt="" className="w-14 h-14 rounded-lg object-cover" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight leading-tight">Gracemark Academy</h1>
          <p className="text-[11px] font-semibold tracking-widest text-amber-700 uppercase">Marked by Grace and Excellence</p>
          <p className="text-[11px] font-bold text-slate-600 mt-1">{heading}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{isTR ? "Student Report" : "Continuous Assessment"}</div>
          <div className="text-sm font-black">{isTR ? "Terminal Result" : report.milestoneLabel.split(" (")[0]}</div>
          {!isTR && <div className="text-[11px] text-slate-500">{report.milestoneLabel.match(/\((.*)\)/)?.[1]}</div>}
        </div>
      </header>

      {/* Student details */}
      <section className="rs-details grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <div className="col-span-2">
          <div className="text-[10px] font-bold uppercase text-slate-500">Student Name</div>
          <div className="font-bold text-sm">{report.student.name}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-500">Admission No</div>
          <div className="font-semibold font-mono">{report.student.admissionNo}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-500">Class</div>
          <div className="font-semibold">
            {report.className}
            {isTR && <span className="text-slate-500 font-normal"> · {report.classSize} in class</span>}
          </div>
        </div>
      </section>

      {report.promotion && (
        <div
          className={`rounded-xl px-4 py-3 text-sm font-bold border ${
            report.promotion.status === "PROMOTED"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : report.promotion.status === "TRIAL"
              ? "bg-amber-50 border-amber-200 text-amber-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          {report.promotion.text}
        </div>
      )}

      {/* Scores */}
      <section>{isTR ? <TRTable report={report} /> : <PRTable report={report} />}</section>

      {/* Summary */}
      {isTR ? (
        <section className="rs-stats grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat label="Overall total" value={fmt(report.summary.total)} sub={`${report.subjects.length} subjects`} />
          <Stat label="Percentage" value={`${fmt(report.summary.percentage)}%`} sub={`${report.summary.grade} · ${report.summary.remark}`} />
          <Stat label="GPA" value={fmt(report.summary.gpa, 2)} sub="out of 5.00" />
          <Stat
            label="Position"
            value={report.summary.position ? ordinal(report.summary.position) : "—"}
            sub={report.summary.rankedCount ? `out of ${report.summary.rankedCount}` : undefined}
          />
        </section>
      ) : (
        <section className="rs-summary flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Overall percentage</div>
            <div className="text-2xl font-black tabular-nums">{fmt(report.summary.percentage)}%</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Summary</div>
            <div className={`text-base font-black ${gradeTone(report.summary.grade)}`}>{report.summary.remark}</div>
          </div>
        </section>
      )}

      {isTR && (
        <section className="rs-lower grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">Personal skills (1 – 5)</div>
            {report.skills ? (
              <table className="w-full text-xs">
                <tbody>
                  {report.skills.map((k) => (
                    <tr key={k.key} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 text-slate-700">{k.label}</td>
                      <td className="px-3 py-1.5 text-right font-bold tabular-nums">{k.score ?? "—"}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-300 bg-slate-50">
                    <td className="px-3 py-1.5 font-bold">Total</td>
                    <td className="px-3 py-1.5 text-right font-black tabular-nums">{report.skillsTotal ?? "—"} / 60</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="px-3 py-4 text-xs text-slate-400">Not recorded.</p>
            )}
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-500">Times opened</div>
                <div className="font-bold text-sm tabular-nums">{report.attendance?.opened ?? "—"}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-500">Present</div>
                <div className="font-bold text-sm tabular-nums">{report.attendance?.present ?? "—"}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-500">Absent</div>
                <div className="font-bold text-sm tabular-nums">{report.attendance?.absent ?? "—"}</div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 px-3 py-2.5">
              <div className="text-[10px] font-bold uppercase text-slate-500">Class teacher&rsquo;s remark</div>
              <p className="text-xs mt-1 text-slate-800">{report.teacherRemark || "—"}</p>
            </div>
            <div className="rounded-xl border border-slate-200 px-3 py-2.5">
              <div className="text-[10px] font-bold uppercase text-slate-500">Principal&rsquo;s remark</div>
              <p className="text-xs mt-1 font-semibold text-slate-900">{report.summary.principalRemark || "—"}</p>
              <div className="flex items-end justify-between gap-3 mt-3">
                <div className="text-xs">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Next term begins</div>
                  <div className="font-semibold">{formatDate(report.nextTermBegins) || "—"}</div>
                </div>
                <div className="text-center">
                  {report.principalSignature ? (
                    <img src={report.principalSignature} alt="Principal's signature" className="h-10 max-w-[120px] object-contain mx-auto" />
                  ) : (
                    <div className="h-10" />
                  )}
                  <div className="text-[10px] font-bold uppercase text-slate-500 border-t border-slate-300 pt-0.5">Principal</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Grading key */}
      <footer className="rs-footer flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-[10px] text-slate-500">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {bands.map((b, i) => {
            const upper = i === 0 ? 100 : bands[i - 1].min;
            return (
              <span key={b.grade}>
                <strong className="text-slate-700">{b.grade}</strong> {b.min}–{i === 0 ? upper : `<${upper}`} {b.remark}
              </span>
            );
          })}
        </div>
        {report.publishedAt && <span>Published {new Date(report.publishedAt).toLocaleDateString("en-GB")}</span>}
      </footer>
    </article>
  );
}
