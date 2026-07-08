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

function ResultsTable({ subjects }) {
  if (!subjects.length) {
    return h(
      "p",
      { className: "text-center text-slate-400 py-12 rd-glass rounded-2xl" },
      "No approved results for this term yet."
    );
  }

  const cols = [
    "Subject",
    "HW",
    "Test",
    "Project",
    "Exam",
    "Total",
    "Class Avg",
    "High/Low",
    "Unit",
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
          subjects.map((row) =>
            h("tr", { key: row.subject }, [
              h("td", { className: "font-semibold text-white" }, row.subject),
              h("td", null, row.hw),
              h("td", null, row.test),
              h("td", null, row.project),
              h("td", null, row.exam),
              h("td", { className: "font-bold text-violet-300" }, row.total),
              h("td", null, row.classAverage),
              h("td", { className: "text-xs text-slate-400" }, `${row.high} / ${row.low}`),
              h("td", null, row.unit),
              h("td", null, h(GradeBadge, { grade: row.grade })),
              h(
                "td",
                {
                  className: row.remark === "EXCELLENT" ? "rd-remark-excellent" : "text-slate-300",
                },
                row.remark
              ),
            ])
          )
        )
      )
    ),
  ]);
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
          h(
            "section",
            { className: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-6" },
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
                label: "GPA",
                value: report.gpa.toFixed(2),
                accent: "blue",
                icon: h(Icon, { d: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" }),
              }),
              h(StatCard, {
                label: "Total Score",
                value: `${report.totalScore}%`,
                icon: h(Icon, { d: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" }),
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
                label: "Percentage",
                value: `${report.percentage}%`,
                accent: "purple",
                icon: h(Icon, { d: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" }),
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
            h(ResultsTable, { subjects: report.subjects }),
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
            { className: "rd-glass rounded-2xl p-5 sm:p-6 mb-6 border border-violet-500/20" },
            [
              h("h2", { className: "text-lg font-bold text-white mb-2" }, "Principal's Remark"),
              h(
                "p",
                { className: "text-slate-300 italic leading-relaxed text-sm sm:text-base" },
                `"${report.principalRemark}"`
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
