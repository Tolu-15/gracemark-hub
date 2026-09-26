"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import ResultDashboardApp from "@/components/student/ResultDashboardApp";
import { getAcademicSessions } from "@/lib/academicSessions";
import { getAppSettings } from "@/lib/appSettings";

type Tab = "student-results" | "class-broadsheet";
type Period = "term1" | "term2" | "term3" | "annual";
type Milestone = "PR1" | "PR2" | "PR3" | "TR";

const TERM_LABEL: Record<string, string> = { term1: "1st Term", term2: "2nd Term", term3: "3rd Term", annual: "Annual" };
const MILESTONE_LABEL: Record<Milestone, string> = { PR1: "Progress Report 1", PR2: "Progress Report 2", PR3: "Progress Report 3", TR: "Terminal Result" };
const GRADES = ["A", "B", "C", "D", "F"];

const fmt = (n: any, dp = 1) =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(dp).replace(/\.0+$/, "");

function ordinal(n: number | null | undefined) {
  if (!n) return "—";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function gradeTone(g?: string) {
  return g === "A" ? "text-emerald-700" : g === "B" ? "text-sky-700" : g === "D" ? "text-amber-700" : g === "F" ? "text-rose-700" : "text-slate-800";
}

export default function AdminHistoricalResultsPage() {
  const [tab, setTab] = useState<Tab>("student-results");
  const [sessions, setSessions] = useState<string[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);

  // Student lookup
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [career, setCareer] = useState<any | null>(null);
  const [loadingCareer, setLoadingCareer] = useState(false);
  const [reportView, setReportView] = useState<{ session: string; term: string } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Broadsheet
  const [bsSession, setBsSession] = useState("");
  const [bsClass, setBsClass] = useState("");
  const [bsPeriod, setBsPeriod] = useState<Period>("term1");
  const [bsMilestone, setBsMilestone] = useState<Milestone>("TR");
  const [bsDetail, setBsDetail] = useState<"summary" | "full">("summary");
  const [sheet, setSheet] = useState<any | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [sheetError, setSheetError] = useState("");

  useEffect(() => {
    (async () => {
      const [sessList, settings, cls] = await Promise.all([
        getAcademicSessions(),
        getAppSettings(),
        supabase.from("classes").select("id, name").order("display_order"),
      ]);
      const names = (sessList || []).map((s: { name: string }) => s.name);
      setSessions(names);
      setBsSession(settings?.current_session || names[0] || "");
      if (settings?.current_term) setBsPeriod(settings.current_term as Period);
      setClasses(cls.data || []);
      if (cls.data?.length) setBsClass(cls.data[0].id);
    })();
  }, []);

  // ---------------- Student lookup ----------------
  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setMatches([]);
      setSearchError("");
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const res = await fetch(`/api/admin/historical-lookup?q=${encodeURIComponent(q.trim())}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Search failed.");
      setMatches(json.matches || []);
      if (!json.matches?.length) setSearchError(`No student found for "${q.trim()}".`);
    } catch (e: any) {
      setSearchError(e.message);
      setMatches([]);
    } finally {
      setSearching(false);
    }
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(value), 300);
  }

  async function selectStudent(id: string) {
    setMatches([]);
    setLoadingCareer(true);
    setCareer(null);
    try {
      const res = await fetch(`/api/admin/historical-lookup?studentId=${encodeURIComponent(id)}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load student.");
      setCareer(json);
    } catch (e: any) {
      setSearchError(e.message);
    } finally {
      setLoadingCareer(false);
    }
  }

  // ---------------- Broadsheet ----------------
  async function generate() {
    if (!bsClass || !bsSession) return;
    setLoadingSheet(true);
    setSheetError("");
    setSheet(null);
    try {
      const params = new URLSearchParams({ classId: bsClass, session: bsSession, term: bsPeriod, milestone: bsMilestone });
      const res = await fetch(`/api/admin/class-broadsheet?${params}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not generate the broadsheet.");
      setSheet(json);
    } catch (e: any) {
      setSheetError(e.message);
    } finally {
      setLoadingSheet(false);
    }
  }

  const isAnnual = sheet?.mode === "annual";
  const isTR = sheet?.milestone === "TR";
  const isPR3 = sheet?.milestone === "PR3";
  const full = bsDetail === "full";

  // Sub-columns per subject
  const subCols: { key: string; label: string }[] = !sheet
    ? []
    : isAnnual
    ? full
      ? [
          { key: "term1", label: "1st" },
          { key: "term2", label: "2nd" },
          { key: "term3", label: "3rd" },
          { key: "annual", label: "Avg" },
          { key: "grade", label: "Gr" },
        ]
      : [
          { key: "annual", label: "Avg" },
          { key: "grade", label: "Gr" },
        ]
    : full
    ? [
        { key: "cw", label: "CW" },
        { key: "hw", label: "HW" },
        { key: "test", label: "Test" },
        ...(isTR || isPR3 ? [{ key: "project", label: "Proj" }] : []),
        ...(isTR ? [{ key: "exam", label: "Exam" }] : []),
        { key: isTR ? "total" : "percentage", label: isTR ? "Total" : "%" },
        { key: "grade", label: "Gr" },
      ]
    : [
        { key: isTR ? "total" : "percentage", label: isTR ? "Total" : "%" },
        { key: "grade", label: "Gr" },
      ];

  const cellValue = (row: any, subjectId: string, key: string) => {
    const src = isAnnual ? row.perSubject[subjectId] : row.lines[subjectId];
    if (!src) return null;
    return src[key];
  };

  const title = sheet
    ? isAnnual
      ? `Annual Broadsheet · ${sheet.session}`
      : `${TERM_LABEL[sheet.term]} ${MILESTONE_LABEL[sheet.milestone as Milestone]} Broadsheet · ${sheet.session}`
    : "";

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto pb-12">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Student Results &amp; Broadsheets</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Look up a student&rsquo;s published results across sessions, or generate a class broadsheet from the scores entered.
          </p>
        </div>
        <div role="tablist" className="inline-flex rounded-xl bg-slate-100 p-1 shrink-0">
          {(
            [
              ["student-results", "Student Results"],
              ["class-broadsheet", "Class Broadsheet"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ================= STUDENT RESULTS ================= */}
      {tab === "student-results" && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs relative print:hidden">
            <label htmlFor="student-search" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Find a student
            </label>
            <input
              id="student-search"
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Type a name or admission number (at least 2 letters)"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
            />
            {searching && <p className="text-xs text-slate-400 mt-2">Searching…</p>}
            {searchError && !searching && <p className="text-xs text-rose-600 mt-2">{searchError}</p>}
            {matches.length > 0 && (
              <ul className="absolute left-5 right-5 top-full -mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-72 overflow-y-auto divide-y divide-slate-100">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => selectStudent(m.id)} className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between gap-3 cursor-pointer">
                      <div>
                        <div className="font-bold text-sm text-slate-900">{m.name}</div>
                        <div className="text-xs text-slate-500">
                          {m.admission_no} · {m.classes?.name || "No class"}
                        </div>
                      </div>
                      <span className="text-xs font-bold text-indigo-700">View →</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {loadingCareer ? (
            <div className="p-12 text-center text-sm text-slate-500 bg-white rounded-2xl border border-slate-200">Loading…</div>
          ) : !career ? (
            <div className="p-12 text-center text-sm text-slate-400 bg-white rounded-2xl border border-slate-200">Search for a student to see their results.</div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900">{career.student.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {career.student.admission_no} · Current class: <strong className="text-slate-800">{career.currentClass}</strong>
                    {career.student.gender ? ` · ${career.student.gender === "male" ? "Male" : career.student.gender === "female" ? "Female" : career.student.gender}` : ""}
                    {career.student.is_alumni ? " · Alumni" : ""}
                  </p>
                  {career.student.guardian_name && (
                    <p className="text-xs text-slate-500">
                      Guardian: {career.student.guardian_name}
                      {career.student.guardian_phone ? ` (${career.student.guardian_phone})` : ""}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sessions</div>
                  <div className="text-2xl font-black text-slate-900">{career.history.length}</div>
                </div>
              </div>

              {career.history.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500 bg-white rounded-2xl border border-slate-200">
                  No session records yet. A student gets one the first time a result or remark is saved for them.
                </div>
              ) : (
                career.history.map((h: any) => (
                  <div key={h.session} className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-extrabold text-slate-900">{h.session}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">{h.historicalClass.name}</span>
                      {h.annualAverage !== null && (
                        <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Annual average {h.annualAverage}%
                        </span>
                      )}
                      {h.promotionDetails && (
                        <span className="text-xs font-semibold text-emerald-700">
                          {h.promotionDetails.action === "repeat"
                            ? `Repeated ${h.promotionDetails.from_class}`
                            : `Promoted ${h.promotionDetails.from_class} → ${h.promotionDetails.to_class}`}
                        </span>
                      )}
                    </div>
                    <div className="grid md:grid-cols-3 gap-3">
                      {(["term1", "term2", "term3"] as const).map((t) => {
                        const d = h.terms[t];
                        return (
                          <div key={t} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-800">{TERM_LABEL[t]}</span>
                              <span className="text-[10px] text-slate-500">
                                {d.published.length ? `Published: ${d.published.map((p: string) => (p === "TR" ? "Terminal" : p)).join(", ")}` : "Nothing published"}
                              </span>
                            </div>
                            {d.tr ? (
                              <div className="grid grid-cols-3 gap-1 text-center">
                                <div>
                                  <div className="text-[9px] font-bold uppercase text-slate-400">Average</div>
                                  <div className="text-sm font-black text-slate-900">{fmt(d.tr.percentage)}%</div>
                                </div>
                                <div>
                                  <div className="text-[9px] font-bold uppercase text-slate-400">Grade</div>
                                  <div className={`text-sm font-black ${gradeTone(d.tr.grade)}`}>{d.tr.grade}</div>
                                </div>
                                <div>
                                  <div className="text-[9px] font-bold uppercase text-slate-400">Position</div>
                                  <div className="text-sm font-black text-slate-900">
                                    {ordinal(d.tr.position)}
                                    {d.tr.rankedCount ? <span className="text-[10px] font-semibold text-slate-400">/{d.tr.rankedCount}</span> : null}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-500">
                                {d.scoresEntered ? `${d.scoresEntered} subject score(s) entered; terminal result not published.` : "No scores entered."}
                              </p>
                            )}
                            <button
                              type="button"
                              disabled={!d.published.length}
                              onClick={() => setReportView({ session: h.session, term: t })}
                              className="w-full py-1.5 text-xs font-bold rounded-lg bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                            >
                              View report card
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* ================= BROADSHEET ================= */}
      {tab === "class-broadsheet" && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-wrap items-end gap-3 print:hidden">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Session
              <select value={bsSession} onChange={(e) => setBsSession(e.target.value)} className="mt-1 block w-36 px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal bg-white">
                {sessions.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Class
              <select value={bsClass} onChange={(e) => setBsClass(e.target.value)} className="mt-1 block w-44 px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal bg-white">
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Period
              <select value={bsPeriod} onChange={(e) => setBsPeriod(e.target.value as Period)} className="mt-1 block w-36 px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal bg-white">
                <option value="term1">1st Term</option>
                <option value="term2">2nd Term</option>
                <option value="term3">3rd Term</option>
                <option value="annual">Annual (whole session)</option>
              </select>
            </label>
            {bsPeriod !== "annual" && (
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Report
                <select value={bsMilestone} onChange={(e) => setBsMilestone(e.target.value as Milestone)} className="mt-1 block w-44 px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal bg-white">
                  <option value="TR">Terminal Result</option>
                  <option value="PR1">Progress Report 1</option>
                  <option value="PR2">Progress Report 2</option>
                  <option value="PR3">Progress Report 3</option>
                </select>
              </label>
            )}
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Detail
              <select value={bsDetail} onChange={(e) => setBsDetail(e.target.value as any)} className="mt-1 block w-44 px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal bg-white">
                <option value="summary">Summary (score &amp; grade)</option>
                <option value="full">Full breakdown</option>
              </select>
            </label>
            <button type="button" onClick={generate} disabled={loadingSheet} className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-50 cursor-pointer">
              {loadingSheet ? "Generating…" : "Generate broadsheet"}
            </button>
            {sheet && (
              <button type="button" onClick={() => window.print()} className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold hover:bg-slate-50 cursor-pointer">
                Print (landscape)
              </button>
            )}
          </div>

          {sheetError && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{sheetError}</div>}

          {sheet && (
            <div className="broadsheet-print bg-white border border-slate-300 rounded-2xl shadow-xs overflow-hidden print:border-0 print:rounded-none">
              {/* Header */}
              <div className="p-4 border-b border-slate-300 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-black uppercase tracking-tight">Gracemark Academy</h2>
                  <p className="text-xs font-bold text-slate-700">
                    {sheet.className} · {title}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Built from the scores entered (published or not). {sheet.isSenior ? "SSS grading; position by GPA." : "JSS grading; position by average."}
                  </p>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-1 text-[11px]">
                  <div>
                    <div className="text-slate-500">Class size</div>
                    <div className="font-bold">{sheet.classSize}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">With results</div>
                    <div className="font-bold">{sheet.classSummary.evaluated}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Class average</div>
                    <div className="font-bold">{fmt(sheet.classSummary.avg)}%</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Highest avg</div>
                    <div className="font-bold text-emerald-700">{fmt(sheet.classSummary.highest)}%</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Lowest avg</div>
                    <div className="font-bold text-rose-700">{fmt(sheet.classSummary.lowest)}%</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Overall grades</div>
                    <div className="font-bold">{GRADES.map((g) => `${g}:${sheet.classSummary.grades[g]}`).join(" ")}</div>
                  </div>
                </div>
              </div>

              {isAnnual && sheet.classSummary.promotion && (
                <div className="px-4 py-2 border-b border-slate-200 text-xs text-slate-700 bg-slate-50">
                  Promotion: <strong className="text-emerald-700">{sheet.classSummary.promotion.PROMOTED} promoted</strong> ·{" "}
                  <strong className="text-amber-700">{sheet.classSummary.promotion.TRIAL} on trial</strong> ·{" "}
                  <strong className="text-rose-700">{sheet.classSummary.promotion.REPEAT} to repeat</strong>
                </div>
              )}

              {!isAnnual && sheet.issues?.some((i: any) => i.code === "not_approved" || i.code === "returned") && (
                <div className="px-4 py-2 border-b border-amber-200 bg-amber-50 text-xs text-amber-900 print:hidden">
                  Some scores are not approved yet, so these figures may still change:{" "}
                  {sheet.issues.filter((i: any) => i.code === "not_approved" || i.code === "returned").map((i: any) => i.message).join(" ")}
                </div>
              )}

              {sheet.rows.length === 0 ? (
                <p className="p-10 text-center text-sm text-slate-400">No scores entered for this class and period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="broadsheet-table w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-slate-100">
                        <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 sticky left-0 bg-slate-100 z-10">Pos</th>
                        <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 text-left sticky left-8 bg-slate-100 z-10 min-w-[150px]">Student</th>
                        {sheet.subjects.map((s: any) => (
                          <th key={s.id} colSpan={subCols.length} className="border border-slate-300 px-1 py-1 font-bold text-center">
                            {s.name}
                            {(isTR || isAnnual) && <span className="block text-[9px] font-normal text-slate-500">unit {s.creditUnit}</span>}
                          </th>
                        ))}
                        <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">Subj.</th>
                        <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">{isAnnual ? "Annual total" : isTR ? "Total" : "Total CA"}</th>
                        <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">Avg %</th>
                        {(isTR || isAnnual) && <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">GPA</th>}
                        <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">Grade</th>
                        <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">Remark</th>
                        {isAnnual && (
                          <>
                            <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">1st avg</th>
                            <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">2nd avg</th>
                            <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">3rd avg</th>
                            <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">Promotion</th>
                          </>
                        )}
                        {isTR && !isAnnual && (
                          <>
                            <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">Attendance</th>
                            <th rowSpan={2} className="border border-slate-300 px-1.5 py-1 bg-slate-200">Skills /60</th>
                          </>
                        )}
                      </tr>
                      <tr className="bg-slate-50 text-[9px] text-slate-600">
                        {sheet.subjects.map((s: any) =>
                          subCols.map((c) => (
                            <th key={`${s.id}-${c.key}`} className="border border-slate-300 px-1 py-0.5 font-semibold">
                              {c.label}
                            </th>
                          ))
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.rows.map((r: any) => (
                        <tr key={r.studentId} className="hover:bg-slate-50">
                          <td className="border border-slate-300 px-1.5 py-1 text-center font-bold sticky left-0 bg-white">{ordinal(r.position)}</td>
                          <td className="border border-slate-300 px-1.5 py-1 sticky left-8 bg-white">
                            <div className="font-semibold text-slate-900 whitespace-nowrap">{r.name}</div>
                            <div className="text-[9px] text-slate-400">{r.admissionNo}</div>
                          </td>
                          {sheet.subjects.map((s: any) =>
                            subCols.map((c) => {
                              const v = cellValue(r, s.id, c.key);
                              return (
                                <td
                                  key={`${r.studentId}-${s.id}-${c.key}`}
                                  className={`border border-slate-300 px-1 py-1 text-center tabular-nums ${c.key === "grade" ? `font-bold ${gradeTone(v)}` : ""} ${
                                    c.key === "total" || c.key === "annual" || c.key === "percentage" ? "font-semibold" : ""
                                  }`}
                                >
                                  {v === null || v === undefined ? <span className="text-slate-300">—</span> : c.key === "grade" ? v : fmt(v)}
                                </td>
                              );
                            })
                          )}
                          <td className="border border-slate-300 px-1.5 py-1 text-center">{r.subjectsTaken}</td>
                          <td className="border border-slate-300 px-1.5 py-1 text-center font-semibold tabular-nums">{fmt(isAnnual ? r.annualTotal : r.total)}</td>
                          <td className="border border-slate-300 px-1.5 py-1 text-center font-bold tabular-nums">{fmt(r.average, 2)}</td>
                          {(isTR || isAnnual) && <td className="border border-slate-300 px-1.5 py-1 text-center tabular-nums">{fmt(r.gpa, 2)}</td>}
                          <td className={`border border-slate-300 px-1.5 py-1 text-center font-black ${gradeTone(r.grade)}`}>{r.grade}</td>
                          <td className="border border-slate-300 px-1.5 py-1 text-center whitespace-nowrap">{r.remark}</td>
                          {isAnnual && (
                            <>
                              {r.termAverages.map((a: number | null, i: number) => (
                                <td key={i} className="border border-slate-300 px-1.5 py-1 text-center tabular-nums">
                                  {fmt(a)}
                                </td>
                              ))}
                              <td
                                className={`border border-slate-300 px-1.5 py-1 text-center font-semibold whitespace-nowrap ${
                                  r.promotion?.status === "PROMOTED" ? "text-emerald-700" : r.promotion?.status === "TRIAL" ? "text-amber-700" : "text-rose-700"
                                }`}
                              >
                                {r.promotion?.status === "PROMOTED" ? "Promoted" : r.promotion?.status === "TRIAL" ? "On trial" : "Repeat"}
                              </td>
                            </>
                          )}
                          {isTR && !isAnnual && (
                            <>
                              <td className="border border-slate-300 px-1.5 py-1 text-center tabular-nums whitespace-nowrap">
                                {r.attendance ? `${r.attendance.present}/${r.attendance.opened}` : "—"}
                              </td>
                              <td className="border border-slate-300 px-1.5 py-1 text-center tabular-nums">{r.skillsTotal ?? "—"}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 text-[10px]">
                      {(
                        [
                          ["avg", "Class average"],
                          ["highest", "Highest"],
                          ["lowest", "Lowest"],
                          ["count", "No. offering"],
                          ["passes", "Passed (not F)"],
                          ...GRADES.map((g) => [`g:${g}`, `No. of ${g}`]),
                        ] as [string, string][]
                      ).map(([key, label]) => (
                        <tr key={key}>
                          <td colSpan={2} className="border border-slate-300 px-1.5 py-1 text-right font-bold sticky left-0 bg-slate-50">
                            {label}
                          </td>
                          {sheet.subjects.map((s: any) => {
                            const st = sheet.subjectStats[s.id] || {};
                            const v = key.startsWith("g:") ? st.grades?.[key.slice(2)] : st[key];
                            return (
                              <td key={`${key}-${s.id}`} colSpan={subCols.length} className="border border-slate-300 px-1 py-1 text-center tabular-nums font-semibold">
                                {v === null || v === undefined ? "—" : key === "count" || key === "passes" || key.startsWith("g:") ? v : fmt(v)}
                              </td>
                            );
                          })}
                          <td colSpan={isAnnual ? 10 : isTR ? 8 : 5} className="border border-slate-300" />
                        </tr>
                      ))}
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="p-6 grid grid-cols-2 gap-12 pt-10 text-xs">
                <div>
                  <div className="border-b border-slate-400 w-64 mb-1" />
                  <span className="font-bold uppercase tracking-wide text-slate-700">Class teacher&rsquo;s signature &amp; date</span>
                </div>
                <div className="text-right">
                  <div className="border-b border-slate-400 w-64 ml-auto mb-1" />
                  <span className="font-bold uppercase tracking-wide text-slate-700">Principal&rsquo;s signature &amp; stamp</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Report card viewer */}
      {reportView && career && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-white print:static print:overflow-visible">
          <ResultDashboardApp
            studentId={career.student.id}
            initialSession={reportView.session}
            initialTerm={reportView.term}
            onClose={() => setReportView(null)}
          />
        </div>
      )}
    </div>
  );
}
