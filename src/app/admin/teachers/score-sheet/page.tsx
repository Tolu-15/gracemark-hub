"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import {
  PR_WINDOWS,
  calculatePR1,
  calculatePR2,
  calculatePR3,
  calculateTR,
  detectAssessmentWeeks,
  emptyScheduledWeeks,
  weeksForFrequency,
  normalizeBreakdown,
  isSeniorClass,
} from "@/lib/gradingEngine";
import { RawScores } from "@/types/result";
import { PageLoader, InlineSpinner } from "@/components/shared/PageLoader";

type ViewMode = "all" | "pr1" | "pr2" | "pr3" | "tr";

interface StudentScoreRow {
  student_id: string;
  name: string;
  admission_no: string;
  raw: RawScores;
  status?: string;
  return_reason?: string | null;
}

/**
 * Read-only mirror of the "Master Continuous Assessment Mark Sheet" teachers
 * use to enter scores (/teacher/score-entry) — same week-by-week CW/HW/Test
 * breakdown, for any class and subject, with zero write controls. Lets admin
 * see exactly what a teacher's score sheet looks like without risking an
 * accidental edit.
 */
export default function AdminScoreSheetPage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedTerm, setSelectedTerm] = useState("term1");
  const [currentSession, setCurrentSession] = useState("");
  const [termList, setTermList] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("all");

  const [classSubjectIds, setClassSubjectIds] = useState<Map<string, string> | null>(null);
  const [notOffering, setNotOffering] = useState<Set<string>>(new Set());

  const [rows, setRows] = useState<StudentScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(true);
  const [error, setError] = useState("");
  const loadSeqRef = React.useRef(0);

  const selectedClassName = classes.find((c) => c.id === selectedClass)?.name || "";
  const isSenior = isSeniorClass(selectedClassName);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/terms");
        if (res.ok) {
          const data = await res.json();
          if (data.ok) {
            setTermList(data.terms || []);
            if (data.current_term) setSelectedTerm(data.current_term);
            if (data.current_session) setCurrentSession(data.current_session);
          }
        }

        const [{ data: cList }, { data: sList }] = await Promise.all([
          supabase.from("classes").select("id, name").order("display_order"),
          supabase.from("subjects").select("id, name").order("name"),
        ]);
        setClasses(cList || []);
        setSubjects(sList || []);
        if (cList?.length) setSelectedClass(cList[0].id);
      } catch (err) {
        console.error("Admin score sheet metadata error:", err);
      } finally {
        setMetaLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedClass) return;
    let cancelled = false;
    (async () => {
      const { data: cls } = await supabase.from("classes").select("subject_group_code").eq("id", selectedClass).maybeSingle();
      const groupCode = (cls as any)?.subject_group_code;
      if (!groupCode) {
        if (!cancelled) setClassSubjectIds(null);
        return;
      }
      const { data: list } = await supabase.from("subject_group_subjects").select("subject_id, frequency").eq("group_code", groupCode);
      if (!cancelled) {
        setClassSubjectIds(list && list.length ? new Map(list.map((l: any) => [l.subject_id, l.frequency || "fortnightly"])) : null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClass]);

  // Subjects actually on the selected class's subject list; every subject if
  // the class has no list configured.
  const availableSubjects = useMemo(() => {
    if (!classSubjectIds) return subjects;
    return subjects.filter((s) => classSubjectIds.has(s.id));
  }, [subjects, classSubjectIds]);

  useEffect(() => {
    if (availableSubjects.length > 0 && (!selectedSubject || !availableSubjects.some((s) => s.id === selectedSubject))) {
      setSelectedSubject(availableSubjects[0].id);
    }
  }, [availableSubjects, selectedSubject]);

  const loadScores = useCallback(async () => {
    if (!selectedClass || !selectedSubject) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError("");
    try {
      const { data: classStudents, error: stErr } = await supabase
        .from("students")
        .select("id, name, admission_no")
        .eq("class_id", selectedClass)
        .order("name");
      if (stErr) throw stErr;
      const studentList = (classStudents || []).map((st: any) => ({
        id: st.id,
        name: st.name || "Student",
        admission_no: st.admission_no || "—",
      }));

      if (!studentList.length) {
        if (loadSeqRef.current === seq) setRows([]);
        return;
      }
      const sIds = studentList.map((s) => s.id);

      const optRes = await fetch(
        `/api/results/optouts?subject_id=${encodeURIComponent(selectedSubject)}&session=${encodeURIComponent(currentSession)}`,
        { headers: await getAuthHeaders() }
      );
      const optJson = await optRes.json().catch(() => ({}));

      let resultsQuery = supabase
        .from("results")
        .select("*")
        .in("student_id", sIds)
        .eq("subject_id", selectedSubject)
        .eq("term", selectedTerm);
      if (currentSession) resultsQuery = resultsQuery.eq("session", currentSession);
      const { data: results, error: rErr } = await resultsQuery;
      if (rErr) throw rErr;

      if (loadSeqRef.current !== seq) return;

      setNotOffering(new Set(optRes.ok && optJson.ok ? optJson.studentIds : []));

      const resultMap = new Map<string, any>();
      (results || []).forEach((r) => resultMap.set(r.student_id, r));

      const newRows: StudentScoreRow[] = studentList.map((s) => {
        const existing = resultMap.get(s.id);
        return {
          student_id: s.id,
          name: s.name,
          admission_no: s.admission_no,
          raw: normalizeBreakdown(existing),
          status: existing?.status || "draft",
          return_reason: existing?.return_reason,
        };
      });
      setRows(newRows);
    } catch (err: any) {
      console.error("Admin score sheet load error:", err);
      if (loadSeqRef.current === seq) setError(err.message || "Failed to load scores.");
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [selectedClass, selectedSubject, selectedTerm, currentSession]);

  useEffect(() => {
    loadScores();
  }, [loadScores]);

  const isFirstLoad = (loading || metaLoading) && rows.length === 0;
  const isRefetching = loading && !metaLoading && rows.length > 0;

  const offeringRows = useMemo(() => rows.filter((r) => !notOffering.has(r.student_id)), [rows, notOffering]);
  const frequency = classSubjectIds?.get(selectedSubject) || null;
  const weeks = useMemo(
    () => (frequency ? weeksForFrequency(frequency) : detectAssessmentWeeks(offeringRows.map((r) => r.raw))),
    [frequency, offeringRows]
  );
  const windowEnd = viewMode === "pr1" ? PR_WINDOWS.pr1 : viewMode === "pr2" ? PR_WINDOWS.pr2 : PR_WINDOWS.pr3;
  const visibleCw = (frequency ? weeks.cw : Array.from({ length: 10 }, (_, i) => i + 1)).filter((w) => w <= windowEnd);
  const visibleHw = (frequency ? weeks.hw : Array.from({ length: 10 }, (_, i) => i + 1)).filter((w) => w <= windowEnd);

  const gapNote = useMemo(() => {
    if (!frequency || !offeringRows.length) return "";
    const raws = offeringRows.map((r) => r.raw);
    const filled = detectAssessmentWeeks(raws);
    const lastFilled = Math.max(0, ...filled.cw, ...filled.hw);
    if (!lastFilled) return "";
    const empty = emptyScheduledWeeks(raws, weeks, lastFilled);
    const parts = [
      empty.cw.length ? `classwork week ${empty.cw.join(", ")}` : "",
      empty.hw.length ? `homework week ${empty.hw.join(", ")}` : "",
    ].filter(Boolean);
    return parts.length ? `${parts.join(" and ")} ${empty.cw.length + empty.hw.length > 1 ? "are" : "is"} empty for every student.` : "";
  }, [frequency, offeringRows, weeks]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Master Continuous Assessment Mark Sheet</h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Read-only</span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            The exact score sheet teachers enter scores on, for any class and subject — view-only, no edits possible from here.
          </p>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

      {rows.some((r) => r.return_reason) && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
          <div className="font-bold text-sm">Returned by the admin for correction</div>
          <div className="mt-1">Message: &ldquo;{rows.find((r) => r.return_reason)?.return_reason}&rdquo;</div>
        </div>
      )}

      {gapNote && <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">Note: {gapNote}</div>}

      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1 w-44">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Class</label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 w-52">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Subject</label>
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              {availableSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 w-40">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Term</label>
            <select
              value={selectedTerm}
              onChange={(e) => setSelectedTerm(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              {termList.length > 0 ? (
                termList.map((t) => (
                  <option key={t.term} value={t.term}>
                    {t.label} {t.is_current ? "(Current)" : t.allow_edit ? "(Unlocked)" : "(Locked)"}
                  </option>
                ))
              ) : (
                <>
                  <option value="term1">1st Term</option>
                  <option value="term2">2nd Term</option>
                  <option value="term3">3rd Term</option>
                </>
              )}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          {(
            [
              { id: "all", label: "All Columns" },
              { id: "pr1", label: "PR1 (W4)" },
              { id: "pr2", label: "PR2 (W7)" },
              { id: "pr3", label: "PR3 (W10)" },
              { id: "tr", label: "Terminal (TR)" },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setViewMode(mode.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === mode.id ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        {isRefetching && (
          <div className="px-4 py-2 border-b border-slate-100">
            <InlineSpinner label="Updating mark sheet…" />
          </div>
        )}
        {isFirstLoad ? (
          <PageLoader label="Loading mark sheet…" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1200px]">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600 text-center">
                  <th className="px-4 py-3 text-left sticky left-0 bg-slate-100 z-10 border-r border-slate-200 w-48">Student Name</th>
                  {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") && (
                    <th colSpan={visibleCw.length} className="px-2 py-1 bg-blue-50/70 border-r border-slate-200 text-blue-900">
                      Classwork (/10 each{frequency ? (frequency === "weekly" ? " · weekly" : " · every 2 weeks") : ""})
                    </th>
                  )}
                  {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") && (
                    <th colSpan={visibleHw.length} className="px-2 py-1 bg-indigo-50/70 border-r border-slate-200 text-indigo-900">
                      Homework (/10 each{frequency ? (frequency === "weekly" ? " · weekly" : " · every 2 weeks") : ""})
                    </th>
                  )}
                  {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") && (
                    <th colSpan={viewMode === "pr1" ? 1 : viewMode === "pr2" ? 2 : 3} className="px-2 py-1 bg-amber-50/70 border-r border-slate-200 text-amber-900">
                      Tests (T1 /15, T2 /15, T3 /30)
                    </th>
                  )}
                  {(viewMode === "all" || viewMode === "tr") && <th className="px-2 py-1 bg-purple-50/70 border-r border-slate-200 text-purple-900">Project (/5)</th>}
                  {(viewMode === "all" || viewMode === "tr") && <th className="px-2 py-1 bg-rose-50/70 border-r border-slate-200 text-rose-900">Exam (/70)</th>}
                  <th className="px-3 py-1 bg-slate-200/80 border-r border-slate-200 text-slate-800">Total</th>
                  <th className="px-3 py-1 bg-slate-200/80 border-r border-slate-200 text-slate-800">Grade</th>
                  <th className="px-3 py-1 bg-slate-200/80 text-slate-800">Remark</th>
                </tr>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-500 text-center">
                  <th className="px-4 py-2 text-left sticky left-0 bg-slate-50 z-10 border-r border-slate-200">Admission No</th>
                  {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") &&
                    visibleCw
                      .map((w) => w - 1)
                      .map((i) => (
                        <th key={`cw-h-${i}`} className="px-1 py-1 border-r border-slate-100 min-w-[34px]">
                          W{i + 1}
                        </th>
                      ))}
                  {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") &&
                    visibleHw
                      .map((w) => w - 1)
                      .map((i) => (
                        <th key={`hw-h-${i}`} className="px-1 py-1 border-r border-slate-100 min-w-[34px]">
                          W{i + 1}
                        </th>
                      ))}
                  {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") && (
                    <>
                      <th className="px-1 py-1 border-r border-slate-100 min-w-[38px]">T1 /15</th>
                      {viewMode !== "pr1" && <th className="px-1 py-1 border-r border-slate-100 min-w-[38px]">T2 /15</th>}
                      {viewMode !== "pr1" && viewMode !== "pr2" && <th className="px-1 py-1 border-r border-slate-100 min-w-[38px]">T3 /30</th>}
                    </>
                  )}
                  {(viewMode === "all" || viewMode === "tr") && <th className="px-1 py-1 border-r border-slate-100 min-w-[38px]">/5</th>}
                  {(viewMode === "all" || viewMode === "tr") && <th className="px-1 py-1 border-r border-slate-100 min-w-[40px]">/70</th>}
                  <th className="px-2 py-1 border-r border-slate-200">Total</th>
                  <th className="px-2 py-1 border-r border-slate-200">Grade</th>
                  <th className="px-2 py-1">Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={30} className="px-6 py-12 text-center text-slate-400">
                      No students found in this class.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const off = notOffering.has(row.student_id);
                    const tr = calculateTR(row.raw, { isSenior, weeks });
                    const pr1 = calculatePR1(row.raw, isSenior, weeks);
                    const pr2 = calculatePR2(row.raw, isSenior, weeks);
                    const pr3 = calculatePR3(row.raw, isSenior, weeks);

                    const displayTotal = viewMode === "pr1" ? pr1.totalCA : viewMode === "pr2" ? pr2.totalCA : viewMode === "pr3" ? pr3.totalCA : tr.totalScore;
                    const displayGrade = viewMode === "pr1" ? pr1.grade : viewMode === "pr2" ? pr2.grade : viewMode === "pr3" ? pr3.grade : tr.grade;
                    const displayRemark = viewMode === "pr1" ? pr1.remark : viewMode === "pr2" ? pr2.remark : viewMode === "pr3" ? pr3.remark : tr.remark;

                    return (
                      <tr key={row.student_id} className={off ? "bg-slate-50 text-slate-400" : "hover:bg-slate-50/50"}>
                        <td className="px-4 py-2 sticky left-0 bg-white border-r border-slate-200 z-10 shadow-xs">
                          <div className={`font-bold truncate max-w-[170px] ${off ? "text-slate-400 line-through" : "text-slate-900"}`}>{row.name}</div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono text-slate-400">{row.admission_no}</span>
                            {off && <span className="text-[10px] font-semibold text-slate-400">Not offering</span>}
                          </div>
                        </td>

                        {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") &&
                          visibleCw
                            .map((w) => w - 1)
                            .map((i) => (
                              <td key={`cw-${i}`} className="p-0.5 border-r border-slate-100 text-center font-semibold text-slate-700">
                                {row.raw.cw[i] ?? "—"}
                              </td>
                            ))}

                        {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") &&
                          visibleHw
                            .map((w) => w - 1)
                            .map((i) => (
                              <td key={`hw-${i}`} className="p-0.5 border-r border-slate-100 text-center font-semibold text-slate-700">
                                {row.raw.hw[i] ?? "—"}
                              </td>
                            ))}

                        {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") && (
                          <>
                            <td className="p-0.5 border-r border-slate-100 text-center font-semibold text-slate-700">{row.raw.tests[0] ?? "—"}</td>
                            {viewMode !== "pr1" && <td className="p-0.5 border-r border-slate-100 text-center font-semibold text-slate-700">{row.raw.tests[1] ?? "—"}</td>}
                            {viewMode !== "pr1" && viewMode !== "pr2" && (
                              <td className="p-0.5 border-r border-slate-100 text-center font-semibold text-slate-700">{row.raw.tests[2] ?? "—"}</td>
                            )}
                          </>
                        )}

                        {(viewMode === "all" || viewMode === "tr") && (
                          <td className="p-0.5 border-r border-slate-100 text-center font-semibold text-slate-700">{row.raw.project ?? "—"}</td>
                        )}
                        {(viewMode === "all" || viewMode === "tr") && (
                          <td className="p-0.5 border-r border-slate-100 text-center font-bold text-slate-800">{row.raw.exam ?? "—"}</td>
                        )}

                        <td className="px-2 py-1 border-r border-slate-200 text-center font-bold text-slate-900 bg-slate-50/50">{off ? "—" : displayTotal}</td>
                        <td className="px-2 py-1 border-r border-slate-200 text-center font-bold text-emerald-700 bg-slate-50/50">{off ? "—" : displayGrade}</td>
                        <td className="px-2 py-1 text-center font-semibold text-[10px] text-slate-600 bg-slate-50/50 truncate max-w-[100px]">
                          {off ? "Not offering" : displayRemark}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
