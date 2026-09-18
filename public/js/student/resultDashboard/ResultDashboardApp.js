import React, { useState, useEffect, useCallback } from "https://esm.sh/react@18.3.1";
import { fetchStudentReport, TERM_OPTIONS, PR_INTERVALS, loadSessions } from "./data.js";

const h = React.createElement;

function Icon({ d, className = "w-5 h-5" }) {
  return h(
    "svg",
    { className, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", "aria-hidden": true },
    h("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d })
  );
}

function scoreColour(total) {
  const n = Number(total);
  if (!Number.isFinite(n)) return "";
  if (n >= 70) return "rd-score-excellent";
  if (n >= 55) return "rd-score-good";
  if (n >= 45) return "rd-score-average";
  if (n >= 40) return "rd-score-poor";
  return "rd-score-fail";
}

function StatCard({ label, value, sub, icon, accent = "violet" }) {
  const accentMap = {
    emerald: "border-emerald-200 bg-emerald-50",
    amber:   "border-amber-200 bg-amber-50",
    blue:    "border-blue-200 bg-blue-50",
    violet:  "border-violet-200 bg-violet-50",
  };
  const textMap = {
    emerald: "text-emerald-700",
    amber:   "text-amber-700",
    blue:    "text-blue-700",
    violet:  "text-violet-700",
  };
  const border = accentMap[accent] || accentMap.violet;
  const textCls = textMap[accent] || textMap.violet;

  return h(
    "div",
    { className: `rd-stat-card rounded-xl p-4 flex flex-col justify-between border-2 ${border}` },
    [
      h("div", { className: "flex items-center justify-between gap-2 mb-1" }, [
        h("span", { className: "text-xs font-bold uppercase tracking-wider text-slate-500" }, label),
        h("span", { className: `${textCls} opacity-70` }, icon),
      ]),
      h("div", { className: "mt-1" }, [
        h("p", { className: `text-2xl sm:text-3xl font-black tracking-tight ${textCls}` }, value),
        sub && h("p", { className: "text-xs text-slate-400 mt-0.5" }, sub),
      ]),
    ]
  );
}

function GradeBadge({ grade }) {
  const g = String(grade || "—").toUpperCase();
  let badgeClass = "rd-badge-f";
  if (g.startsWith("A")) badgeClass = "rd-badge-a";
  else if (g.startsWith("B")) badgeClass = "rd-badge-b";
  else if (g.startsWith("C")) badgeClass = "rd-badge-c";
  else if (g.startsWith("D")) badgeClass = "rd-badge-d";
  else if (g.startsWith("E")) badgeClass = "rd-badge-e";
  else if (g === "F" || g === "F9") badgeClass = "rd-badge-f";

  return h("span", { className: `rd-badge-grade ${badgeClass}` }, g);
}

function SelectField({ label, value, onChange, options, disabled = false }) {
  return h("div", { className: "flex flex-col gap-1 min-w-[7.5rem]" }, [
    h("label", { className: "text-[11px] font-bold uppercase tracking-wider text-slate-400" }, label),
    h(
      "select",
      {
        className: "rd-select w-full text-xs font-semibold",
        value,
        disabled,
        onChange: (e) => onChange(e.target.value),
      },
      options.map((opt) =>
        h("option", { key: opt.value, value: opt.value }, opt.label)
      )
    ),
  ]);
}

function PromotionBanner({ statusInfo }) {
  if (!statusInfo) return null;
  const isSuccess = statusInfo.code === "success";
  const isWarning = statusInfo.code === "warning";

  const bannerCls = isSuccess
    ? "bg-emerald-50 border-emerald-300 text-emerald-800"
    : isWarning
      ? "bg-amber-50 border-amber-300 text-amber-800"
      : "bg-red-50 border-red-300 text-red-800";

  return h(
    "div",
    { className: `rd-promotion-banner rounded-xl p-4 sm:p-5 mb-6 border-2 flex flex-wrap items-center justify-between gap-4 ${bannerCls}` },
    [
      h("div", { className: "space-y-1" }, [
        h("div", { className: "text-[11px] font-bold uppercase tracking-widest opacity-70" }, "Session Promotion Decision"),
        h("h2", { className: "text-lg sm:text-xl font-black tracking-tight" }, statusInfo.text),
      ]),
      h(
        "span",
        {
          className: `px-4 py-2 rounded-lg text-xs font-extrabold uppercase tracking-widest ${
            isSuccess
              ? "bg-emerald-600 text-white"
              : isWarning
                ? "bg-amber-500 text-white"
                : "bg-red-600 text-white"
          }`,
        },
        statusInfo.status
      ),
    ]
  );
}

function TerminalResultsTable({ subjects, term, isSenior }) {
  if (!subjects.length) {
    return h(
      "p",
      { className: "text-center text-slate-500 py-12 rd-glass rounded-xl border border-slate-200" },
      "No approved results for this term yet."
    );
  }

  const isTerm3 = term === "term3";
  const termName = term === "term1" ? "First Term" : term === "term2" ? "Second Term" : "Third Term";

  return h("div", { className: "rd-table-section mb-6" }, [
    h(
      "div",
      { className: "flex items-center justify-between pb-2 rd-no-print" },
      [
        h("span", { className: "text-xs font-semibold text-slate-500 uppercase tracking-wider" },
          isTerm3 ? "Cumulative Terminal Scores (TR1 – TR3)" : `${termName} Terminal Scores`
        ),
        h(
          "span",
          { className: "rd-table-scroll-hint text-[11px] text-slate-400 hidden sm:inline" },
          "← Scroll horizontally to see full table →"
        ),
      ]
    ),
    h(
      "div",
      { className: "rd-table-wrap" },
      h(
        "table",
        { className: "rd-table" },
        [
          h("thead", null, [
            isTerm3
              ? h("tr", { className: "rd-thead-row-1" }, [
                  h("th", { rowSpan: 2, className: "rd-col-subject text-left" }, "SUBJECT"),
                  h("th", { rowSpan: 2, className: "text-center font-bold" }, [
                    "1ST TERM",
                    h("span", { className: "block text-[9px] font-normal text-slate-500" }, "100"),
                  ]),
                  h("th", { rowSpan: 2, className: "text-center font-bold" }, [
                    "2ND TERM",
                    h("span", { className: "block text-[9px] font-normal text-slate-500" }, "100"),
                  ]),
                  h("th", { colSpan: 6, className: "text-center rd-th-group" }, "THIRD TERM ASSESSMENT"),
                  h("th", { rowSpan: 2, className: "text-center font-black rd-td-annual" }, [
                    "ANNUAL AVG",
                    h("span", { className: "block text-[9px] font-normal" }, "100"),
                  ]),
                  h("th", { rowSpan: 2, className: "text-center text-xs rd-td-classavg" }, "CLASS AVG"),
                  h("th", { rowSpan: 2, className: "text-center text-xs rd-td-low" }, "LOWEST"),
                  h("th", { rowSpan: 2, className: "text-center text-xs rd-td-high" }, "HIGHEST"),
                  h("th", { rowSpan: 2, className: "text-center font-bold" }, "GRADE"),
                  h("th", { rowSpan: 2, className: "text-left" }, "REMARK"),
                ])
              : h("tr", { className: "rd-thead-row-1" }, [
                  h("th", { rowSpan: 2, className: "rd-col-subject text-left" }, "SUBJECT"),
                  h("th", { colSpan: 6, className: "text-center rd-th-group" }, `${termName.toUpperCase()} SCORES`),
                  h("th", { rowSpan: 2, className: "text-center text-xs rd-td-classavg" }, "CLASS AVG"),
                  h("th", { rowSpan: 2, className: "text-center text-xs rd-td-low" }, "LOWEST"),
                  h("th", { rowSpan: 2, className: "text-center text-xs rd-td-high" }, "HIGHEST"),
                  h("th", { rowSpan: 2, className: "text-center font-bold" }, "GRADE"),
                  h("th", { rowSpan: 2, className: "text-left" }, "REMARK"),
                ]),
            h("tr", { className: "rd-thead-row-2" }, [
              h("th", { className: "text-center" }, ["CW", h("span", { className: "block text-[9px]" }, "10")]),
              h("th", { className: "text-center" }, ["HW", h("span", { className: "block text-[9px]" }, "5")]),
              h("th", { className: "text-center" }, ["TEST", h("span", { className: "block text-[9px]" }, "10")]),
              h("th", { className: "text-center" }, ["PROJ", h("span", { className: "block text-[9px]" }, "5")]),
              h("th", { className: "text-center" }, ["EXAM", h("span", { className: "block text-[9px]" }, "70")]),
              h("th", { className: "text-center font-bold rd-td-total" }, ["TOTAL", h("span", { className: "block text-[9px] font-normal" }, "100")]),
            ]),
          ]),
          h(
            "tbody",
            null,
            subjects.map((row, idx) => {
              const totalCls = scoreColour(row.total);
              const cells = [
                h("td", { className: "font-bold rd-td-subject", key: "subj" }, row.subject)
              ];

              if (isTerm3) {
                cells.push(
                  h("td", { className: `text-center font-medium ${scoreColour(row.term1_total)}`, key: "t1" }, row.term1_total !== null ? row.term1_total : "—"),
                  h("td", { className: `text-center font-medium ${scoreColour(row.term2_total)}`, key: "t2" }, row.term2_total !== null ? row.term2_total : "—"),
                  h("td", { className: "text-center text-slate-600", key: "cw" }, row.cw !== null ? row.cw : "—"),
                  h("td", { className: "text-center text-slate-600", key: "hw" }, row.hw !== null ? row.hw : "—"),
                  h("td", { className: "text-center text-slate-600", key: "test" }, row.test !== null ? row.test : "—"),
                  h("td", { className: "text-center text-slate-600", key: "proj" }, row.project !== null ? row.project : "—"),
                  h("td", { className: "text-center text-slate-600", key: "exam" }, row.exam !== null ? row.exam : "—"),
                  h("td", { className: `text-center rd-td-total ${scoreColour(row.total)}`, key: "t3_total" }, row.total),
                  h("td", { className: `text-center rd-td-annual ${scoreColour(row.annualAverage)}`, key: "annual" },
                    row.annualAverage !== null ? row.annualAverage : "—"
                  )
                );
              } else {
                cells.push(
                  h("td", { className: "text-center text-slate-600", key: "cw" }, row.cw !== null ? row.cw : "—"),
                  h("td", { className: "text-center text-slate-600", key: "hw" }, row.hw !== null ? row.hw : "—"),
                  h("td", { className: "text-center text-slate-600", key: "test" }, row.test !== null ? row.test : "—"),
                  h("td", { className: "text-center text-slate-600", key: "proj" }, row.project !== null ? row.project : "—"),
                  h("td", { className: "text-center text-slate-600", key: "exam" }, row.exam !== null ? row.exam : "—"),
                  h("td", { className: `text-center rd-td-total ${totalCls}`, key: "total" }, row.total)
                );
              }

              const remarkCls =
                row.remark === "EXCELLENT" || row.remark === "VERY GOOD"
                  ? "rd-remark-excellent"
                  : row.remark === "GOOD" ? "rd-remark-good"
                  : row.remark === "FAIL" ? "rd-remark-fail"
                  : "rd-remark-average";

              cells.push(
                h("td", { className: "text-center rd-td-classavg", key: "avg" }, row.classAverage),
                h("td", { className: "text-center rd-td-low text-xs", key: "low" }, row.low),
                h("td", { className: "text-center rd-td-high text-xs", key: "high" }, row.high),
                h("td", { className: "text-center", key: "grade" }, h(GradeBadge, { grade: row.grade })),
                h("td", { className: `text-xs font-semibold ${remarkCls}`, key: "rem" }, row.remark)
              );

              return h("tr", { key: row.subject, className: idx % 2 === 0 ? "rd-tr-even" : "rd-tr-odd" }, cells);
            })
          ),
        ]
      )
    ),
  ]);
}

function ProgressReportTable({
  subjects,
  term,
  isSenior,
  activePrKey = "pr1",
  activeInterval,
  prOverallPercentage,
  prSummary,
  prTotalCa,
  prMaxCa,
}) {
  if (!subjects.length) {
    return h(
      "p",
      { className: "text-center text-slate-400 py-12 rd-glass rounded-xl" },
      "No approved continuous assessment records for this term yet."
    );
  }

  const termName = term === "term1" ? "First Term" : term === "term2" ? "Second Term" : "Third Term";
  const intervalTitle = activeInterval?.label ?? "PR 1 (Weeks 1 – 3)";

  return h("div", { className: "rd-table-section mb-6" }, [
    h(
      "div",
      { className: "flex items-center justify-between pb-2 rd-no-print" },
      [
        h("span", { className: "text-xs font-semibold text-slate-400 uppercase tracking-wider" },
          `${termName} Continuous Assessment — ${intervalTitle}`
        ),
        h(
          "span",
          { className: "rd-table-scroll-hint text-[11px] text-amber-400 hidden sm:inline" },
          "← Scroll horizontally to see all CA columns →"
        ),
      ]
    ),
    h(
      "div",
      { className: "rd-table-wrap rd-glass rounded-xl" },
      h(
        "table",
        { className: "rd-table" },
        [
          h("thead", null, [
            h("tr", { className: "rd-thead-row-1" }, [
              h("th", { className: "rd-col-subject text-left" }, "SUBJECT"),
              h("th", { className: "text-center font-bold" }, [
                "CLASS WORK",
                h("span", { className: "block text-[9px] font-normal text-slate-400" }, "10MKS"),
              ]),
              h("th", { className: "text-center font-bold" }, [
                "HOME WORK",
                h("span", { className: "block text-[9px] font-normal text-slate-400" }, "5MKS"),
              ]),
              h("th", { className: "text-center font-bold" }, [
                "REGULAR TEST",
                h("span", { className: "block text-[9px] font-normal text-slate-400" }, "15MKS"),
              ]),
              h("th", { className: "text-center font-black text-white bg-violet-950/50" }, [
                "TOTAL CA",
                h("span", { className: "block text-[9px] font-normal text-slate-300" }, "30MKS"),
              ]),
              h("th", { className: "text-center font-black text-amber-300 bg-amber-950/40" }, [
                "PERCENTAGE",
                h("span", { className: "block text-[9px] font-normal text-slate-300" }, "100%"),
              ]),
              h("th", { className: "text-center font-bold" }, "GRADE"),
              h("th", { className: "text-left" }, "STATUS"),
            ]),
          ]),
          h(
            "tbody",
            null,
            subjects.map((row, idx) => {
              const pr = (row.prs && row.prs[activePrKey]) || row.pr || {};
              const pctCls = scoreColour(pr.percentage);
              const statusCls =
                pr.status === "EXCELLENT" || pr.status === "VERY GOOD" ? "rd-remark-excellent"
                : pr.status === "FAIL" ? "rd-remark-fail"
                : "rd-remark-average";
              return h("tr", { key: row.subject, className: idx % 2 === 0 ? "rd-tr-even" : "rd-tr-odd" }, [
                h("td", { className: "font-bold rd-td-subject" }, row.subject),
                h("td", { className: "text-center text-slate-700 font-medium" }, pr.cw ?? "—"),
                h("td", { className: "text-center text-slate-700 font-medium" }, pr.hw ?? "—"),
                h("td", { className: "text-center text-slate-700 font-medium" }, pr.test ?? "—"),
                h("td", { className: "text-center rd-td-total font-extrabold" }, pr.hasData ? pr.totalCa : "—"),
                h("td", { className: `text-center rd-td-annual font-black text-sm ${pctCls}` },
                  pr.hasData && pr.percentage !== undefined ? `${pr.percentage}%` : "—"
                ),
                h("td", { className: "text-center" }, pr.hasData ? h(GradeBadge, { grade: pr.grade }) : "—"),
                h("td", { className: `text-xs font-semibold ${statusCls}` }, pr.status),
              ]);
            })
          ),
          h(
            "tfoot",
            null,
            h("tr", { className: "border-t-2 border-slate-300 font-bold text-xs" }, [
              h("td", { className: "font-black text-slate-800 uppercase text-left py-3 px-3" }, `OVERALL CA SUMMARY (${activeInterval?.shortLabel || "PR 1"}):`),
              h("td", { colSpan: 3, className: "text-center text-slate-500" }, `Total CA Points: ${prTotalCa} / ${prMaxCa}`),
              h("td", { className: "text-center rd-td-total font-extrabold" }, prTotalCa),
              h("td", { className: `text-center rd-td-annual font-black text-sm ${scoreColour(prOverallPercentage)}` }, `${prOverallPercentage}%`),
              h("td", { className: "text-center" }, "—"),
              h("td", { className: "text-left rd-remark-excellent font-bold uppercase" }, prSummary),
            ])
          ),
        ]
      )
    ),
  ]);
}

function PersonalSkillsTable({ traits, traitsTotal }) {
  if (!traits || !traits.length) return null;

  return h("div", { className: "rd-glass rounded-xl p-5 mb-6" }, [
    h("div", { className: "flex items-center justify-between mb-4 border-b border-slate-200 pb-3" }, [
      h("h3", { className: "text-sm font-bold text-slate-800 uppercase tracking-wider" }, "Personal Skills & Behavioral Ratings"),
      h("span", { className: "text-xs font-extrabold text-violet-700 bg-violet-50 px-3 py-1 rounded-full border border-violet-200" },
        `Total Score: ${traitsTotal} / ${traits.length * 5}`
      ),
    ]),
    h(
      "div",
      { className: "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" },
      traits.map((t) => {
        const score = Number(t.score) || 0;
        const scoreCls = score >= 4 ? "text-emerald-700" : score >= 3 ? "text-blue-700" : score >= 2 ? "text-amber-600" : "text-red-600";
        return h(
          "div",
          {
            key: t.name,
            className: "flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs",
          },
          [
            h("span", { className: "font-medium text-slate-700" }, t.name),
            h("div", { className: "flex items-center gap-1.5" }, [
              h("span", { className: `font-black text-sm ${scoreCls}` }, score),
              h("span", { className: "text-slate-400 text-[10px]" }, "/ 5"),
            ]),
          ]
        );
      })
    ),
  ]);
}

export function ResultDashboardApp({ student, initialTerm, initialSession, onClose }) {
  const [reportType, setReportType] = useState("TR"); // "TR" = Terminal Report, "PR" = Progress Report
  const [prIntervalKey, setPrIntervalKey] = useState("pr1"); // "pr1" | "pr2" | "pr3"
  const [term, setTerm] = useState(initialTerm || "term1");
  const [session, setSession] = useState(initialSession || "");
  const [sessions, setSessions] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const className = student?.classes?.name ?? "—";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchStudentReport({ student, term, session });
      setReport(data);
    } catch (err) {
      setError(err?.message || "Failed to load results.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [student, term, session]);

  useEffect(() => {
    loadSessions().then((list) => {
      setSessions(list);
      if (!session && list[0]) setSession(list[0]);
    });
  }, []);

  useEffect(() => {
    if (student && session) load();
  }, [student, term, session, load]);

  const sessionOptions = sessions.map((s) => ({ value: s, label: s }));

  const isProgressReport = reportType === "PR";
  const activeInterval = PR_INTERVALS.find((p) => p.value === prIntervalKey) || PR_INTERVALS[0];
  const activePrMetrics = report?.prIntervals?.[prIntervalKey] ?? {
    overallPercentage: report?.prOverallPercentage ?? 0,
    totalCa: report?.prTotalCa ?? 0,
    maxCa: report?.prMaxCa ?? 0,
    summary: report?.prSummary ?? "—",
  };

  const documentTitle = isProgressReport
    ? `${termLabel(term)} Continuous Assessment Report — ${activeInterval.label}`
    : term === "term1"
      ? "First Term Student Report Sheet"
      : term === "term2"
        ? "Second Term Student Report Sheet"
        : "Third Term Student Cumulative Report Sheet";

  function termLabel(t) {
    if (t === "term1") return "First Term";
    if (t === "term2") return "Second Term";
    if (t === "term3") return "Third Term";
    return t || "Term";
  }

  return h(
    "div",
    { className: "rd-root min-h-full" },
    h(
      "button",
      {
        type: "button",
        className: "rd-close-btn rd-no-print",
        onClick: onClose,
        "aria-label": "Close results",
      },
      "×"
    ),
    h(
      "div",
      { className: "rd-inner" },
      [
        /* Top Navigation Controls (Hidden in Print) */
        h(
          "div",
          { className: "rd-glass rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-4 rd-no-print" },
          [
            /* Report Type Switcher */
            h("div", { className: "flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200 gap-1" }, [
              h(
                "button",
                {
                  type: "button",
                  className: `px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                    reportType === "TR"
                      ? "bg-violet-600 text-white shadow"
                      : "text-slate-500 hover:text-slate-800"
                  }`,
                  onClick: () => setReportType("TR"),
                },
                "Terminal Report (TR)"
              ),
              h(
                "button",
                {
                  type: "button",
                  className: `px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                    reportType === "PR"
                      ? "bg-amber-500 text-white font-extrabold shadow"
                      : "text-slate-500 hover:text-slate-800"
                  }`,
                  onClick: () => setReportType("PR"),
                },
                "Progress Report (PR)"
              ),
            ]),

            /* Filter fields */
            h("div", { className: "flex flex-wrap items-center gap-3" }, [
              h(SelectField, {
                label: "Academic Session",
                value: session,
                onChange: setSession,
                options: sessionOptions.length ? sessionOptions : [{ value: "", label: "—" }],
              }),
              h(SelectField, {
                label: "Term",
                value: term,
                onChange: setTerm,
                options: TERM_OPTIONS,
              }),
            ]),

            /* Action buttons */
            h("div", { className: "flex items-center gap-3" }, [
              h(
                "button",
                {
                  type: "button",
                  className: "rd-btn-print px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow",
                  onClick: () => window.print(),
                },
                [
                  h(Icon, { d: "M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" }),
                  isProgressReport ? `Print ${activeInterval.shortLabel}` : "Print Terminal Sheet",
                ]
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "px-4 py-2.5 border border-slate-300 hover:bg-slate-100 text-slate-600 font-semibold text-xs rounded-lg transition-colors",
                  onClick: onClose,
                },
                "Close"
              ),
            ]),

            /* 3-Week Interval Tabs for Progress Reports */
            isProgressReport &&
              h(
                "div",
                { className: "w-full flex items-center justify-between flex-wrap gap-2 pt-3 border-t border-slate-200" },
                [
                  h("div", { className: "flex items-center gap-2" }, [
                    h("span", { className: "text-xs font-bold text-amber-600 uppercase tracking-wider" }, "Progress Report Interval:"),
                    h("span", { className: "text-[11px] text-slate-400 hidden sm:inline" }, "(3-week evaluation cycles)"),
                  ]),
                  h(
                    "div",
                    { className: "flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-amber-200 flex-wrap" },
                    PR_INTERVALS.map((intv) =>
                      h(
                        "button",
                        {
                          key: intv.value,
                          type: "button",
                          className: `px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                            prIntervalKey === intv.value
                              ? "bg-amber-500 text-white font-black shadow ring-2 ring-amber-300"
                              : "text-slate-500 hover:text-slate-800 hover:bg-slate-200"
                          }`,
                          onClick: () => setPrIntervalKey(intv.value),
                        },
                        [
                          h("span", null, intv.shortLabel),
                          h("span", { className: `text-[10px] ${prIntervalKey === intv.value ? "text-white/80" : "text-slate-400"}` }, `(${intv.weeks})`),
                        ]
                      )
                    )
                  ),
                ]
              ),
          ]
        ),

        /* Official Report Sheet Container */
        h(
          "div",
          { className: `rd-sheet-container p-4 sm:p-8 ${isProgressReport ? "rd-sheet-pr" : "rd-sheet-tr"}` },
          [
            /* Official Header Banner */
            h("header", { className: `rd-school-header border-b-2 pb-6 mb-6 text-center ${isProgressReport ? "border-amber-400" : "border-emerald-500"}` }, [
              h("div", { className: "flex flex-col items-center justify-center gap-2" }, [
                h("div", {
                  className: `w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg mb-1 ${
                    isProgressReport ? "bg-amber-500" : "bg-emerald-600"
                  }`
                }, [
                  h(Icon, { d: "M12 14l9-5-9-5-9 5 9 5z M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z", className: "w-8 h-8" }),
                ]),
                h("h1", { className: "text-2xl sm:text-3xl font-black tracking-tight text-slate-900 uppercase" }, "Gracemark Academy"),
                h("p", { className: "text-xs font-semibold text-emerald-600 uppercase tracking-widest" }, "Knowledge, Discipline & Character"),
                h("div", {
                  className: `mt-2 inline-block px-4 py-1.5 rounded-md border text-xs sm:text-sm font-black uppercase tracking-wider ${
                    isProgressReport
                      ? "bg-amber-50 border-amber-400 text-amber-800"
                      : "bg-slate-50 border-slate-300 text-slate-800"
                  }`
                },
                  documentTitle
                ),
                isProgressReport && h("p", { className: "text-[11px] text-amber-700 mt-1 font-semibold" }, `Evaluation Period: ${activeInterval.weeks} (Checkpoint: ${activeInterval.checkpoint}) · Continuous Assessment (CA)`),
              ]),
            ]),

            /* Student Bio Card */
            h("div", { className: "rd-student-bio grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl mb-6 text-xs" }, [
              h("div", null, [
                h("span", { className: "text-slate-500 block font-semibold uppercase text-[10px]" }, "Student Name"),
                h("strong", { className: "text-slate-900 text-sm font-bold block truncate" }, report?.studentName ?? student?.name ?? "—"),
              ]),
              h("div", null, [
                h("span", { className: "text-slate-500 block font-semibold uppercase text-[10px]" }, "Admission No"),
                h("strong", { className: "text-emerald-700 text-sm font-mono block" }, report?.admissionNo ?? student?.admission_no ?? "—"),
              ]),
              h("div", null, [
                h("span", { className: "text-slate-500 block font-semibold uppercase text-[10px]" }, "Class"),
                h("strong", { className: "text-slate-900 text-sm font-bold block" }, className),
              ]),
              h("div", null, [
                h("span", { className: "text-slate-500 block font-semibold uppercase text-[10px]" }, "Academic Session"),
                h("strong", { className: "text-violet-700 text-sm font-bold block" }, session || "—"),
              ]),
              h("div", null, [
                h("span", { className: "text-slate-500 block font-semibold uppercase text-[10px]" }, "Report Type"),
                h("strong", { className: `text-sm font-bold block ${isProgressReport ? "text-amber-600" : "text-emerald-700"}` },
                  isProgressReport ? `${activeInterval.shortLabel} Progress Report` : "Terminal Result (TR)"
                ),
              ]),
              h("div", null, [
                h("span", { className: "text-slate-500 block font-semibold uppercase text-[10px]" }, isProgressReport ? "Evaluation Period" : "Days Opened"),
                h("strong", { className: "text-slate-800 text-sm font-bold block" }, isProgressReport ? activeInterval.weeks : String(report?.daysOpened ?? 120)),
              ]),
              h("div", null, [
                h("span", { className: "text-slate-500 block font-semibold uppercase text-[10px]" }, isProgressReport ? "Assessment Checkpoint" : "Days Present"),
                h("strong", { className: "text-slate-800 text-sm font-bold block" }, isProgressReport ? activeInterval.checkpoint : String(report?.daysPresent ?? 120)),
              ]),
              h("div", null, [
                h("span", { className: "text-slate-500 block font-semibold uppercase text-[10px]" }, "Educational Tier"),
                h("strong", { className: "text-amber-600 text-sm font-bold block uppercase" }, report?.isSenior ? "Senior Secondary" : "Junior Secondary"),
              ]),
            ]),

            loading &&
              h(
                "div",
                { className: "text-center py-20 text-slate-500 animate-pulse font-medium" },
                "Loading academic records…"
              ),

            error &&
              !loading &&
              h("div", { className: "p-6 bg-red-50 border border-red-200 text-red-700 rounded-xl text-center mb-6" }, error),

            report &&
              !loading &&
              (isProgressReport
                ? /* ==================== PROGRESS REPORT (PR) VIEW ==================== */
                  h(React.Fragment, null, [
                    /* Progress Report Key Stat Cards */
                    h(
                      "section",
                      { className: "grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" },
                      [
                        h(StatCard, {
                          label: "Overall CA Percentage",
                          value: `${activePrMetrics.overallPercentage}%`,
                          sub: `${activeInterval.shortLabel} (${activeInterval.weeks}) Avg`,
                          accent: "amber",
                          icon: h(Icon, { d: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" }),
                        }),
                        h(StatCard, {
                          label: "Performance Status",
                          value: activePrMetrics.summary,
                          sub: `Based on ${activeInterval.shortLabel} CA average`,
                          accent: "emerald",
                          icon: h(Icon, { d: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" }),
                        }),
                        h(StatCard, {
                          label: "Total CA Score",
                          value: String(activePrMetrics.totalCa),
                          sub: `out of ${activePrMetrics.maxCa} points`,
                          accent: "violet",
                          icon: h(Icon, { d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" }),
                        }),
                        h(StatCard, {
                          label: "Subjects Assessed",
                          value: String(report.totalResults),
                          sub: "Continuous evaluation",
                          accent: "blue",
                          icon: h(Icon, { d: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" }),
                        }),
                      ]
                    ),

                    /* Progress Report Table */
                    h(ProgressReportTable, {
                      subjects: report.subjects,
                      term: term,
                      isSenior: report.isSenior,
                      activePrKey: prIntervalKey,
                      activeInterval: activeInterval,
                      prOverallPercentage: activePrMetrics.overallPercentage,
                      prSummary: activePrMetrics.summary,
                      prTotalCa: activePrMetrics.totalCa,
                      prMaxCa: activePrMetrics.maxCa,
                    }),

                    /* Progress Report Guidance */
                    h("div", { className: "p-4 rounded-xl bg-amber-50 border border-amber-200 mb-6 text-xs" }, [
                      h("h4", { className: "text-xs font-bold uppercase tracking-wider text-amber-700 mb-1" }, "Continuous Assessment Evaluation Notice"),
                      h("p", { className: "leading-relaxed text-amber-800" },
                        `This progress report reflects continuous assessment results for ${activeInterval.label} covering Class Work (10 Marks), Home Work / Assignments (5 Marks), and Regular Test at ${activeInterval.checkpoint} (15 Marks) for a total CA score of 30 Marks. Final terminal exams will be conducted at the end of term.`
                      ),
                    ]),

                    h("footer", { className: "rd-sheet-footer pt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500" }, [
                      h("div", { className: "flex items-center gap-2 font-medium" }, [
                        h("span", { className: "text-slate-400 uppercase text-[10px] font-bold" }, "Assessment Status:"),
                        h("strong", { className: "text-emerald-700 text-xs font-bold" }, activePrMetrics.summary),
                      ]),
                      h("div", { className: "flex items-center gap-6" }, [
                        h("div", { className: "text-center" }, [
                          h("div", { className: "border-b border-slate-400 w-36 mb-1" }),
                          h("span", { className: "text-[10px] text-slate-500 uppercase font-bold" }, "Class Teacher's Signature"),
                        ]),
                        h("div", { className: "text-center" }, [
                          h("div", { className: "border-b border-slate-400 w-24 mb-1" }),
                          h("span", { className: "text-[10px] text-slate-500 uppercase font-bold" }, "Date"),
                        ]),
                      ]),
                    ]),
                  ])
                : /* ==================== TERMINAL REPORT (TR) VIEW ==================== */
                  h(React.Fragment, null, [
                    /* Promotion status banner (Term 3) */
                    term === "term3" && h(PromotionBanner, { statusInfo: report.promotionStatus }),

                    /* Key Performance Summary Cards */
                    h(
                      "section",
                      { className: "grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" },
                      [
                        h(StatCard, {
                          label: "Class Position",
                          value: report.position,
                          sub: report.classSize ? `out of ${report.classSize} students` : null,
                          accent: "violet",
                          icon: h(Icon, { d: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" }),
                        }),
                        h(StatCard, {
                          label: "Average Percentage",
                          value: `${report.percentage}%`,
                          sub: term === "term3" ? "Annual Cumulative Avg" : "Term Average",
                          accent: "amber",
                          icon: h(Icon, { d: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" }),
                        }),
                        h(StatCard, {
                          label: "Overall Total Mark",
                          value: String(report.overallTotal),
                          sub: `across ${report.totalResults} subjects`,
                          accent: "emerald",
                          icon: h(Icon, { d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" }),
                        }),
                        h(StatCard, {
                          label: "Attendance Rate",
                          value: `${report.attendancePct}%`,
                          sub: `${report.timesPresent} of ${report.timesOpened} sessions`,
                          accent: "blue",
                          icon: h(Icon, { d: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" }),
                        }),
                      ]
                    ),

                    /* Main Academic Results Table matching TR1 - TR3 Full Result */
                    h(TerminalResultsTable, {
                      subjects: report.subjects,
                      term: term,
                      isSenior: report.isSenior,
                    }),

                    /* Personal Skills / Behavioral Ratings Table */
                    h(PersonalSkillsTable, {
                      traits: report.traits,
                      traitsTotal: report.traitsTotal,
                    }),

                    /* AI Academic Analysis (Digital view) */
                    h(
                      "section",
                      { className: "rd-ai-box rounded-xl p-5 mb-6 rd-no-print" },
                      [
                        h("div", { className: "flex items-center gap-2 mb-2" }, [
                          h("span", { className: "text-emerald-600" }, h(Icon, { d: "M13 10V3L4 14h7v7l9-11h-7z" })),
                          h("h3", { className: "text-xs font-bold text-slate-800 uppercase tracking-wider" }, "Academic Performance Insight"),
                        ]),
                        h("p", { className: "text-xs sm:text-sm text-slate-700 leading-relaxed" }, report.aiInsight),
                      ]
                    ),

                    /* Remarks & Signatures */
                    h("div", { className: "rd-remarks-grid grid grid-cols-1 md:grid-cols-2 gap-6 mb-6" }, [
                      h("div", { className: "p-4" }, [
                        h("h4", { className: "text-xs font-bold uppercase tracking-wider text-slate-500 mb-2" }, "Class Teacher's Remark"),
                        h("p", { className: "text-sm text-slate-800 italic" }, `"${report.teacherRemark}"`),
                      ]),
                      h("div", { className: "p-4" }, [
                        h("h4", { className: "text-xs font-bold uppercase tracking-wider text-slate-500 mb-2" }, "Principal's Remark"),
                        h("p", { className: "text-sm text-amber-700 font-semibold uppercase italic" }, `"${report.principalRemark}"`),
                      ]),
                    ]),

                    /* Footer */
                    h("footer", { className: "rd-sheet-footer pt-6 flex flex-wrap items-center justify-between gap-4 text-xs" }, [
                      h("div", { className: "flex items-center gap-2 font-medium" }, [
                        h("span", { className: "text-slate-400 uppercase text-[10px] font-bold" }, "Next Term Begins:"),
                        h("strong", { className: "text-slate-800 text-xs" }, report.nextTermBegins),
                      ]),
                      h("div", { className: "flex items-center gap-6" }, [
                        h("div", { className: "text-center" }, [
                          report.principalSignature
                            ? h("img", { src: report.principalSignature, alt: "Principal Signature", className: "h-8 max-w-[8rem] mx-auto mb-1 object-contain" })
                            : h("div", { className: "border-b border-slate-400 w-32 mb-1" }),
                          h("span", { className: "text-[10px] text-slate-500 uppercase font-bold" }, "Principal's Signature"),
                        ]),
                        h("div", { className: "text-center" }, [
                          h("div", { className: "text-xs font-semibold text-slate-800 mb-1" }, report.publishedDate || "Approved"),
                          h("span", { className: "text-[10px] text-slate-500 uppercase font-bold" }, "Date Published"),
                        ]),
                      ]),
                    ]),
                  ])
              ),
          ]
        ),
      ]
    )
  );
}
