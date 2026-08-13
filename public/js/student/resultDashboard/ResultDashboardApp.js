import React, { useState, useEffect, useCallback } from "https://esm.sh/react@18.3.1";
import { fetchStudentReport, TERM_OPTIONS, loadSessions } from "./data.js";

const h = React.createElement;

function Icon({ d, className = "w-5 h-5" }) {
  return h(
    "svg",
    { className, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", "aria-hidden": true },
    h("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d })
  );
}

function StatCard({ label, value, icon, accent = "purple" }) {
  const accentClass =
    accent === "blue"
      ? "text-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.2)]"
      : "text-violet-400 shadow-[0_0_20px_rgba(168,85,247,0.2)]";
  return h(
    "div",
    {
      className:
        "rd-stat-card rd-glass rounded-2xl p-4 flex flex-col gap-2 " + accentClass,
    },
    h("div", { className: "flex items-center justify-between" }, [
      h("span", { className: "text-xs font-medium uppercase tracking-wider text-slate-400" }, label),
      h("span", { className: "opacity-80" }, icon),
    ]),
    h("p", { className: "text-2xl font-bold text-white tracking-tight" }, value)
  );
}

function GradeBadge({ grade }) {
  const g = String(grade || "F").toUpperCase();
  const cls =
    g === "A"
      ? "rd-badge-a"
      : g === "B"
        ? "rd-badge-b"
        : g === "C"
          ? "rd-badge-c"
          : g === "D"
            ? "rd-badge-d"
            : "rd-badge-f";
  return h("span", { className: `rd-badge-grade ${cls}` }, g);
}

function SelectField({ label, value, onChange, options, disabled = false }) {
  return h("div", { className: "flex flex-col gap-1 min-w-[7rem]" }, [
    h("label", { className: "text-xs font-semibold uppercase tracking-wide text-slate-300" }, label),
    h(
      "select",
      {
        className: "rd-select w-full",
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

function ResultsTable({ subjects, term }) {
  if (!subjects.length) {
    return h(
      "p",
      { className: "text-center text-slate-400 py-12 rd-glass rounded-2xl" },
      "No approved results for this term yet."
    );
  }

  const isTerm3 = term === "term3";
  const cols = isTerm3
    ? [
        "Subject",
        "1st Term (30%)",
        "2nd Term (30%)",
        "3rd Term (40%)",
        "Annual Total",
        "Class Avg",
        "High/Low",
        "Grade",
        "Remark",
      ]
    : [
        "Subject",
        "HW",
        "Test",
        "Project",
        "Exam",
        "Total",
        "Class Avg",
        "High/Low",
        "Grade",
        "Remark",
      ];

  return h("div", { className: "rd-table-section" }, [
    h(
      "p",
      { className: "rd-table-scroll-hint", "aria-hidden": "true" },
      "Swipe sideways to see all subject scores →"
    ),
    h(
      "div",
      { className: "rd-table-wrap rd-glass rounded-2xl" },
      h(
        "table",
        { className: "rd-table" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            cols.map((c) => h("th", { key: c }, c))
          )
        ),
        h(
          "tbody",
          null,
          subjects.map((row) => {
            const cells = [
              h("td", { className: "font-semibold text-white", key: "subj" }, row.subject)
            ];

            if (isTerm3) {
              cells.push(
                h("td", { key: "t1" }, row.term1_total !== null ? row.term1_total : "—"),
                h("td", { key: "t2" }, row.term2_total !== null ? row.term2_total : "—"),
                h("td", { key: "t3" }, row.term3_total !== null ? row.term3_total : "—"),
                h("td", { className: "font-bold text-violet-300", key: "annual" }, row.annualTotal !== null ? row.annualTotal : "—")
              );
            } else {
              cells.push(
                h("td", { key: "hw" }, row.hw),
                h("td", { key: "test" }, row.test),
                h("td", { key: "project" }, row.project),
                h("td", { key: "exam" }, row.exam),
                h("td", { className: "font-bold text-violet-300", key: "total" }, row.total)
              );
            }

            cells.push(
              h("td", { key: "avg" }, row.classAverage),
              h("td", { className: "text-xs text-slate-400", key: "hilow" }, `${row.high} / ${row.low}`),
              h("td", { key: "grade" }, h(GradeBadge, { grade: row.grade })),
              h(
                "td",
                {
                  className: row.remark === "EXCELLENT" ? "rd-remark-excellent" : "text-slate-300",
                  key: "rem"
                },
                row.remark
              )
            );

            return h("tr", { key: row.subject }, cells);
          })
        )
      )
    ),
  ]);
}

function PromotionBanner({ statusInfo }) {
  if (!statusInfo) return null;
  const isSuccess = statusInfo.code === "success";
  const isWarning = statusInfo.code === "warning";
  const bgCls = isSuccess
    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
    : isWarning
      ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
      : "bg-rose-500/10 border-rose-500/30 text-rose-300";

  return h(
    "div",
    { className: `rd-glass rounded-2xl p-5 mb-6 border flex items-center justify-between gap-4 ${bgCls}` },
    [
      h("div", { className: "space-y-1" }, [
        h("p", { className: "text-xs font-bold uppercase tracking-wider opacity-80" }, "Session Promotion Decision"),
        h("h2", { className: "text-xl font-extrabold tracking-tight" }, statusInfo.text),
      ]),
      h(
        "span",
        {
          className: `px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${
            isSuccess
              ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/30"
              : isWarning
                ? "bg-amber-500/20 text-amber-200 border border-amber-400/30"
                : "bg-rose-500/20 text-rose-200 border border-rose-400/30"
          }`,
        },
        statusInfo.status
      ),
    ]
  );
}

export function ResultDashboardApp({ student, initialTerm, initialSession, onClose }) {
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
      h(
        "header",
        { className: "rd-glass rounded-2xl p-4 sm:p-6 mb-6" },
        h("div", { className: "flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4" }, [
          h("div", { className: "space-y-3 flex-1" }, [
            h("p", { className: "text-xs font-bold uppercase tracking-[0.2em] text-violet-400" }, "Academic Report"),
            h(
              "h1",
              { className: "text-2xl sm:text-3xl font-bold text-white" },
              report?.studentName ?? student?.name ?? "Student"
            ),
            h(
              "div",
              { className: "flex flex-wrap gap-4 text-sm text-slate-400" },
              [
                h("span", null, ["Class: ", h("strong", { className: "text-slate-200" }, className)]),
                h("span", null, ["Session: ", h("strong", { className: "text-slate-200" }, session || "—")]),
                h("span", null, [
                  "Total Results: ",
                  h("strong", { className: "text-violet-300" }, String(report?.totalResults ?? 0)),
                ]),
              ]
            ),
            h(
              "div",
              { className: "flex flex-wrap gap-3 rd-no-print" },
              [
                h(SelectField, {
                  label: "Academic Year",
                  value: session,
                  onChange: setSession,
                  options: sessionOptions.length ? sessionOptions : [{ value: "", label: "—" }],
                }),
                h(SelectField, {
                  label: "Class",
                  value: className,
                  onChange: () => {},
                  disabled: true,
                  options: [{ value: className, label: className }],
                }),
                h(SelectField, {
                  label: "Term",
                  value: term,
                  onChange: setTerm,
                  options: TERM_OPTIONS,
                }),
              ]
            ),
          ]),
          h(
            "button",
            {
              type: "button",
              className:
                "rd-btn-print rd-no-print px-6 py-3 rounded-xl text-white font-semibold text-sm whitespace-nowrap self-start lg:self-end",
              onClick: () => window.print(),
            },
            "Print Result"
          ),
        ])
      ),

      loading &&
        h(
          "div",
          { className: "text-center py-20 text-slate-400 animate-pulse" },
          "Loading academic report…"
        ),

      error &&
        !loading &&
        h("div", { className: "rd-glass rounded-2xl p-6 text-red-400 text-center mb-6" }, error),

      report &&
        !loading &&
        h(React.Fragment, null, [
          term === "term3" && h(PromotionBanner, { statusInfo: report.promotionStatus }),
          h(
            "section",
            { className: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6" },
            [
              h(StatCard, {
                label: "Position",
                value: report.position,
                accent: "purple",
                icon: h(Icon, {
                  d: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
                }),
              }),
              h(StatCard, {
                label: "Total Score",
                value: `${report.totalScore}%`,
                icon: h(Icon, { d: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" }),
              }),
              h(StatCard, {
                label: "GPA",
                value: String(report.gpa ?? "0.0"),
                accent: "purple",
                icon: h(Icon, { d: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" }),
              }),
              h(StatCard, {
                label: "Attendance",
                value: `${report.attendancePct}%`,
                accent: "blue",
                icon: h(Icon, { d: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" }),
              }),
              h(StatCard, {
                label: "In Class",
                value: String(report.classSize),
                icon: h(Icon, { d: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" }),
              }),
              h(StatCard, {
                label: "Days Opened",
                value: String(report.daysOpened),
                accent: "blue",
                icon: h(Icon, { d: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" }),
              }),
            ]
          ),

          h(
            "section",
            { className: "rd-ai-box rd-glass rounded-2xl p-5 sm:p-6 mb-6" },
            h("div", { className: "flex items-center gap-2 mb-3" }, [
              h(
                "span",
                { className: "text-amber-400" },
                h(Icon, {
                  className: "w-6 h-6",
                  d: "M13 10V3L4 14h7v7l9-11h-7z",
                })
              ),
              h("h2", { className: "text-lg font-bold text-white tracking-wide" }, "AI INSIGHT"),
            ]),
            h("p", { className: "text-sm sm:text-base text-slate-300 leading-relaxed" }, report.aiInsight)
          ),

          h("section", { className: "mb-6" }, [
            h("h2", { className: "text-lg font-bold text-white mb-3" }, "Subject Results"),
            h(ResultsTable, { subjects: report.subjects, term: term }),
          ]),

          h("section", { className: "mb-6" }, [
            h("h2", { className: "text-lg font-bold text-white mb-3" }, "Affective & Psychomotor Traits"),
            h(
              "div",
              { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" },
              report.traits.map((t) =>
                h(
                  "div",
                  { key: t.name, className: "rd-trait-pill" },
                  h("span", { className: "text-sm text-slate-300" }, t.name),
                  h(
                    "span",
                    { className: "text-sm font-bold text-violet-300" },
                    `${t.score}/${t.max}`
                  )
                )
              )
            ),
          ]),

          h(
            "section",
            { className: "grid grid-cols-1 md:grid-cols-2 gap-6 mb-6" },
            [
              h(
                "div",
                { className: "rd-glass rounded-2xl p-5 sm:p-6 border border-violet-500/10" },
                [
                  h("h2", { className: "text-lg font-bold text-white mb-2" }, "Form Teacher's Remark"),
                  h(
                    "p",
                    { className: "text-slate-300 italic leading-relaxed text-sm sm:text-base" },
                    `"${report.teacherRemark}"`
                  ),
                ]
              ),
              h(
                "div",
                { className: "rd-glass rounded-2xl p-5 sm:p-6 border border-violet-500/10" },
                [
                  h("h2", { className: "text-lg font-bold text-white mb-2" }, "Principal's Remark"),
                  h(
                    "p",
                    { className: "text-slate-300 italic leading-relaxed text-sm sm:text-base" },
                    `"${report.principalRemark}"`
                  ),
                ]
              ),
            ]
          ),

          h(
            "footer",
            { className: "rd-footer-notice" },
            `Next Term Begins: ${report.nextTermBegins}`
          ),
        ])
    )
  );
}
