"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  GRADING_CONFIG,
  calculatePR1,
  calculatePR2,
  calculatePR3,
  calculateTR,
  emptyRawScores,
  normalizeBreakdown,
  toStoredScores,
  validateRawScores,
  isSeniorClass,
} from "@/lib/gradingEngine";
import { RawScores } from "@/types/result";

type ViewMode = "all" | "pr1" | "pr2" | "pr3" | "tr";

interface StudentScoreRow {
  student_id: string;
  name: string;
  admission_no: string;
  raw: RawScores;
  resultId?: string;
  status?: string;
  return_reason?: string | null;
}

export default function TeacherScoreEntryPage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedTerm, setSelectedTerm] = useState("term1");
  const [currentSession, setCurrentSession] = useState("2025/2026");

  const [termList, setTermList] = useState<any[]>([]);
  const [isEditable, setIsEditable] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("all");

  const [rows, setRows] = useState<StudentScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const selectedClassName = classes.find((c) => c.id === selectedClass)?.name || "";
  const isSenior = isSeniorClass(selectedClassName);

  const loadMetadata = useCallback(async () => {
    try {
      // 1. Fetch term permissions
      const res = await fetch("/api/terms");
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setTermList(data.terms || []);
          if (data.current_term) setSelectedTerm(data.current_term);
          if (data.current_session) setCurrentSession(data.current_session);
        }
      }

      // 2. Fetch teacher assigned classes & subjects
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) return;

      const { data: assignments } = await supabase
        .from("teacher_assignments")
        .select("class_id, subject_id, classes(id, name), subjects(id, name)")
        .eq("teacher_user_id", user.id);

      const classMap = new Map<string, { id: string; name: string }>();
      const subjectMap = new Map<string, { id: string; name: string }>();

      (assignments || []).forEach((a: any) => {
        if (a.classes?.name) classMap.set(a.classes.id, a.classes);
        if (a.subjects?.name) subjectMap.set(a.subjects.id, a.subjects);
      });

      let cList = Array.from(classMap.values());
      let sList = Array.from(subjectMap.values());

      if (!cList.length) {
        const { data: allCl } = await supabase.from("classes").select("id, name").order("name");
        cList = allCl || [];
      }
      if (!sList.length) {
        const { data: allSub } = await supabase.from("subjects").select("id, name").order("name");
        sList = allSub || [];
      }

      setClasses(cList);
      setSubjects(sList);
      if (cList.length > 0 && !selectedClass) setSelectedClass(cList[0].id);
      if (sList.length > 0 && !selectedSubject) setSelectedSubject(sList[0].id);
    } catch (err) {
      console.error("Load score entry metadata error:", err);
    }
  }, [selectedClass, selectedSubject]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  // Check if current term is editable
  useEffect(() => {
    const t = termList.find((item) => item.term === selectedTerm);
    if (t) {
      setIsEditable(Boolean(t.allow_edit));
    } else {
      setIsEditable(true);
    }
  }, [selectedTerm, termList]);

  // Load scores for selected Class, Subject, and Term
  const loadScores = useCallback(async () => {
    if (!selectedClass || !selectedSubject) return;
    setLoading(true);
    setStatusMsg("");

    try {
      // 1. Fetch all students in class
      const { data: students, error: sErr } = await supabase
        .from("students")
        .select("id, name, admission_no")
        .eq("class_id", selectedClass)
        .order("name", { ascending: true });

      if (sErr) throw sErr;
      if (!students || !students.length) {
        setRows([]);
        setLoading(false);
        return;
      }

      const sIds = students.map((s) => s.id);

      // 2. Fetch existing results
      const { data: results, error: rErr } = await supabase
        .from("results")
        .select("*")
        .in("student_id", sIds)
        .eq("subject_id", selectedSubject)
        .eq("term", selectedTerm);

      if (rErr) throw rErr;

      const resultMap = new Map<string, any>();
      (results || []).forEach((r) => resultMap.set(r.student_id, r));

      const newRows: StudentScoreRow[] = students.map((s) => {
        const existing = resultMap.get(s.id);
        const raw = normalizeBreakdown(existing);
        return {
          student_id: s.id,
          name: s.name,
          admission_no: s.admission_no,
          raw,
          resultId: existing?.id,
          status: existing?.status || "draft",
          return_reason: existing?.return_reason,
        };
      });

      setRows(newRows);
    } catch (err: any) {
      console.error("Load scores error:", err);
      setStatusMsg(`Error loading scores: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedClass, selectedSubject, selectedTerm]);

  useEffect(() => {
    loadScores();
  }, [loadScores]);

  // Update cell score in state
  function updateScore(
    rowIndex: number,
    field: "cw" | "hw" | "tests" | "project" | "exam",
    subIndex: number,
    val: string
  ) {
    if (!isEditable) return;
    setRows((prev) => {
      const copy = [...prev];
      const row = { ...copy[rowIndex], raw: { ...copy[rowIndex].raw } };

      if (field === "cw" || field === "hw" || field === "tests") {
        const arr = [...(row.raw[field] as any[])];
        arr[subIndex] = val;
        (row.raw as any)[field] = arr;
      } else {
        row.raw[field] = val;
      }

      copy[rowIndex] = row;
      return copy;
    });
  }

  // Save draft or submit
  async function handleSave(submit = false) {
    if (!rows.length) return;
    setSaving(true);
    setStatusMsg("");

    try {
      const recordsToSave = rows.map((r) => {
        const tr = calculateTR(r.raw, { isSenior, className: selectedClassName });
        const stored = toStoredScores(tr, r.raw);

        return {
          student_id: r.student_id,
          subject_id: selectedSubject,
          class_id: selectedClass,
          term: selectedTerm,
          session: currentSession,
          ...stored,
          status: submit ? "submitted" : r.status || "draft",
          submitted_at: submit ? new Date().toISOString() : undefined,
        };
      });

      const res = await fetch("/api/results/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: recordsToSave }),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error || "Failed to save results.");
      }

      setStatusMsg(
        submit
          ? "Scores submitted to administration for approval!"
          : "Draft scores saved successfully!"
      );
      loadScores();
    } catch (err: any) {
      console.error("Save scores exception:", err);
      setStatusMsg(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setStatusMsg(""), 5000);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top action header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Master Continuous Assessment Mark Sheet
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            10-week continuous assessment (CW /10, HW /5, Tests /10, Prj /5, Exam /70) with checkpoint progress tracking.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving || !isEditable || rows.length === 0}
            onClick={() => handleSave(false)}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold rounded-xl text-xs shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Draft"}
          </button>
          <button
            type="button"
            disabled={saving || !isEditable || rows.length === 0}
            onClick={() => handleSave(true)}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Submit to Admin"}
          </button>
        </div>
      </div>

      {/* Lock status banner */}
      {!isEditable && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🔒</span>
            <span>
              <strong>Score Editing Locked for {selectedTerm}:</strong> Only the active school term can be edited. Contact an administrator to unlock this term.
            </span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-900 font-bold text-[10px] uppercase tracking-wide">
            Read-Only
          </span>
        </div>
      )}

      {statusMsg && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold ${
            statusMsg.startsWith("Save failed") || statusMsg.startsWith("Error")
              ? "bg-rose-50 text-rose-700 border border-rose-200"
              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          {statusMsg}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Class select */}
          <div className="flex flex-col gap-1 w-44">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Class
            </label>
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

          {/* Subject select */}
          <div className="flex flex-col gap-1 w-52">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Subject
            </label>
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Term select */}
          <div className="flex flex-col gap-1 w-40">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Term
            </label>
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

        {/* View Mode Switcher */}
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
                viewMode === mode.id
                  ? "bg-white text-slate-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Spreadsheet Mark Sheet Grid */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600 text-center">
                <th className="px-4 py-3 text-left sticky left-0 bg-slate-100 z-10 border-r border-slate-200 w-48">
                  Student Name
                </th>

                {/* Classwork CW 1-10 */}
                {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") && (
                  <th
                    colSpan={viewMode === "pr1" ? 4 : viewMode === "pr2" ? 7 : 10}
                    className="px-2 py-1 bg-blue-50/70 border-r border-slate-200 text-blue-900"
                  >
                    Classwork (/10 each · Scaled /10)
                  </th>
                )}

                {/* Homework HW 1-10 */}
                {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") && (
                  <th
                    colSpan={viewMode === "pr1" ? 4 : viewMode === "pr2" ? 7 : 10}
                    className="px-2 py-1 bg-indigo-50/70 border-r border-slate-200 text-indigo-900"
                  >
                    Homework (/10 each · Scaled /5)
                  </th>
                )}

                {/* Tests */}
                {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") && (
                  <th
                    colSpan={viewMode === "pr1" ? 1 : viewMode === "pr2" ? 2 : 3}
                    className="px-2 py-1 bg-amber-50/70 border-r border-slate-200 text-amber-900"
                  >
                    Tests (T1 /15, T2 /15, T3 /30)
                  </th>
                )}

                {/* Project */}
                {(viewMode === "all" || viewMode === "tr") && (
                  <th className="px-2 py-1 bg-purple-50/70 border-r border-slate-200 text-purple-900">
                    Project (/5)
                  </th>
                )}

                {/* Exam */}
                {(viewMode === "all" || viewMode === "tr") && (
                  <th className="px-2 py-1 bg-rose-50/70 border-r border-slate-200 text-rose-900">
                    Exam (/70)
                  </th>
                )}

                {/* Summaries */}
                <th className="px-3 py-1 bg-slate-200/80 border-r border-slate-200 text-slate-800">
                  Total
                </th>
                <th className="px-3 py-1 bg-slate-200/80 border-r border-slate-200 text-slate-800">
                  Grade
                </th>
                <th className="px-3 py-1 bg-slate-200/80 text-slate-800">
                  Remark
                </th>
              </tr>

              {/* Subheader Column Labels */}
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-500 text-center">
                <th className="px-4 py-2 text-left sticky left-0 bg-slate-50 z-10 border-r border-slate-200">
                  Admission No
                </th>

                {/* CW Subheaders */}
                {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") &&
                  Array.from({ length: viewMode === "pr1" ? 4 : viewMode === "pr2" ? 7 : 10 }).map((_, i) => (
                    <th key={`cw-h-${i}`} className="px-1 py-1 border-r border-slate-100 min-w-[34px]">
                      W{i + 1}
                    </th>
                  ))}

                {/* HW Subheaders */}
                {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") &&
                  Array.from({ length: viewMode === "pr1" ? 4 : viewMode === "pr2" ? 7 : 10 }).map((_, i) => (
                    <th key={`hw-h-${i}`} className="px-1 py-1 border-r border-slate-100 min-w-[34px]">
                      W{i + 1}
                    </th>
                  ))}

                {/* Test Subheaders */}
                {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") && (
                  <>
                    <th className="px-1 py-1 border-r border-slate-100 min-w-[38px]">T1 /15</th>
                    {viewMode !== "pr1" && (
                      <th className="px-1 py-1 border-r border-slate-100 min-w-[38px]">T2 /15</th>
                    )}
                    {viewMode !== "pr1" && viewMode !== "pr2" && (
                      <th className="px-1 py-1 border-r border-slate-100 min-w-[38px]">T3 /30</th>
                    )}
                  </>
                )}

                {/* Prj */}
                {(viewMode === "all" || viewMode === "tr") && (
                  <th className="px-1 py-1 border-r border-slate-100 min-w-[38px]">/5</th>
                )}

                {/* Exam */}
                {(viewMode === "all" || viewMode === "tr") && (
                  <th className="px-1 py-1 border-r border-slate-100 min-w-[40px]">/70</th>
                )}

                <th className="px-2 py-1 border-r border-slate-200">Total</th>
                <th className="px-2 py-1 border-r border-slate-200">Grade</th>
                <th className="px-2 py-1">Remark</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={30} className="px-6 py-12 text-center text-slate-400">
                    Loading mark sheet…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={30} className="px-6 py-12 text-center text-slate-400">
                    No students found in this class.
                  </td>
                </tr>
              ) : (
                rows.map((row, rIdx) => {
                  const tr = calculateTR(row.raw, { isSenior, className: selectedClassName });
                  const pr1 = calculatePR1(row.raw, isSenior);
                  const pr2 = calculatePR2(row.raw, isSenior);
                  const pr3 = calculatePR3(row.raw, isSenior);

                  const displayTotal =
                    viewMode === "pr1"
                      ? pr1.totalCA
                      : viewMode === "pr2"
                      ? pr2.totalCA
                      : viewMode === "pr3"
                      ? pr3.totalCA
                      : tr.totalScore;

                  const displayGrade =
                    viewMode === "pr1"
                      ? pr1.grade
                      : viewMode === "pr2"
                      ? pr2.grade
                      : viewMode === "pr3"
                      ? pr3.grade
                      : tr.grade;

                  const displayRemark =
                    viewMode === "pr1"
                      ? pr1.remark
                      : viewMode === "pr2"
                      ? pr2.remark
                      : viewMode === "pr3"
                      ? pr3.remark
                      : tr.remark;

                  return (
                    <tr key={row.student_id} className="hover:bg-slate-50/50">
                      {/* Name & Admission */}
                      <td className="px-4 py-2 sticky left-0 bg-white border-r border-slate-200 z-10 shadow-xs">
                        <div className="font-bold text-slate-900 truncate max-w-[170px]">
                          {row.name}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          {row.admission_no}
                        </div>
                      </td>

                      {/* CW Inputs */}
                      {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") &&
                        Array.from({ length: viewMode === "pr1" ? 4 : viewMode === "pr2" ? 7 : 10 }).map((_, i) => (
                          <td key={`cw-${i}`} className="p-0.5 border-r border-slate-100 text-center">
                            <input
                              type="number"
                              min={0}
                              max={10}
                              disabled={!isEditable}
                              value={row.raw.cw[i] ?? ""}
                              onChange={(e) => updateScore(rIdx, "cw", i, e.target.value)}
                              className="w-8 h-7 text-center font-semibold text-xs border border-transparent hover:border-slate-300 focus:border-indigo-500 rounded bg-transparent focus:bg-white outline-none"
                            />
                          </td>
                        ))}

                      {/* HW Inputs */}
                      {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") &&
                        Array.from({ length: viewMode === "pr1" ? 4 : viewMode === "pr2" ? 7 : 10 }).map((_, i) => (
                          <td key={`hw-${i}`} className="p-0.5 border-r border-slate-100 text-center">
                            <input
                              type="number"
                              min={0}
                              max={10}
                              disabled={!isEditable}
                              value={row.raw.hw[i] ?? ""}
                              onChange={(e) => updateScore(rIdx, "hw", i, e.target.value)}
                              className="w-8 h-7 text-center font-semibold text-xs border border-transparent hover:border-slate-300 focus:border-indigo-500 rounded bg-transparent focus:bg-white outline-none"
                            />
                          </td>
                        ))}

                      {/* Tests */}
                      {(viewMode === "all" || viewMode === "pr1" || viewMode === "pr2" || viewMode === "pr3") && (
                        <>
                          <td className="p-0.5 border-r border-slate-100 text-center">
                            <input
                              type="number"
                              min={0}
                              max={15}
                              disabled={!isEditable}
                              value={row.raw.tests[0] ?? ""}
                              onChange={(e) => updateScore(rIdx, "tests", 0, e.target.value)}
                              className="w-9 h-7 text-center font-semibold text-xs border border-transparent hover:border-slate-300 focus:border-indigo-500 rounded bg-transparent focus:bg-white outline-none"
                            />
                          </td>
                          {viewMode !== "pr1" && (
                            <td className="p-0.5 border-r border-slate-100 text-center">
                              <input
                                type="number"
                                min={0}
                                max={15}
                                disabled={!isEditable}
                                value={row.raw.tests[1] ?? ""}
                                onChange={(e) => updateScore(rIdx, "tests", 1, e.target.value)}
                                className="w-9 h-7 text-center font-semibold text-xs border border-transparent hover:border-slate-300 focus:border-indigo-500 rounded bg-transparent focus:bg-white outline-none"
                              />
                            </td>
                          )}
                          {viewMode !== "pr1" && viewMode !== "pr2" && (
                            <td className="p-0.5 border-r border-slate-100 text-center">
                              <input
                                type="number"
                                min={0}
                                max={30}
                                disabled={!isEditable}
                                value={row.raw.tests[2] ?? ""}
                                onChange={(e) => updateScore(rIdx, "tests", 2, e.target.value)}
                                className="w-9 h-7 text-center font-semibold text-xs border border-transparent hover:border-slate-300 focus:border-indigo-500 rounded bg-transparent focus:bg-white outline-none"
                              />
                            </td>
                          )}
                        </>
                      )}

                      {/* Project */}
                      {(viewMode === "all" || viewMode === "tr") && (
                        <td className="p-0.5 border-r border-slate-100 text-center">
                          <input
                            type="number"
                            min={0}
                            max={5}
                            disabled={!isEditable}
                            value={row.raw.project ?? ""}
                            onChange={(e) => updateScore(rIdx, "project", 0, e.target.value)}
                            className="w-9 h-7 text-center font-semibold text-xs border border-transparent hover:border-slate-300 focus:border-indigo-500 rounded bg-transparent focus:bg-white outline-none"
                          />
                        </td>
                      )}

                      {/* Exam */}
                      {(viewMode === "all" || viewMode === "tr") && (
                        <td className="p-0.5 border-r border-slate-100 text-center">
                          <input
                            type="number"
                            min={0}
                            max={70}
                            disabled={!isEditable}
                            value={row.raw.exam ?? ""}
                            onChange={(e) => updateScore(rIdx, "exam", 0, e.target.value)}
                            className="w-10 h-7 text-center font-bold text-xs border border-transparent hover:border-slate-300 focus:border-indigo-500 rounded bg-transparent focus:bg-white outline-none"
                          />
                        </td>
                      )}

                      {/* Calculated Total */}
                      <td className="px-2 py-1 border-r border-slate-200 text-center font-bold text-slate-900 bg-slate-50/50">
                        {displayTotal}
                      </td>

                      {/* Calculated Grade */}
                      <td className="px-2 py-1 border-r border-slate-200 text-center font-bold text-emerald-700 bg-slate-50/50">
                        {displayGrade}
                      </td>

                      {/* Calculated Remark */}
                      <td className="px-2 py-1 text-center font-semibold text-[10px] text-slate-600 bg-slate-50/50 truncate max-w-[100px]">
                        {displayRemark}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
