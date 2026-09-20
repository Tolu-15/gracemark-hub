"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";

interface StudentAttendance {
  student_id: string;
  name: string;
  admission_no: string;
  am: boolean;
  pm: boolean;
  timesPresent: number;
  timesOpened: number;
}

export default function TeacherAttendancePage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [activeTab, setActiveTab] = useState<"summary" | "daily">("summary");
  
  // Term and session state
  const [currentSession, setCurrentSession] = useState("2026/2027");
  const [currentTerm, setCurrentTerm] = useState("term2");
  const [defaultTimesOpened, setDefaultTimesOpened] = useState(65);

  // Daily mode state
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  const [students, setStudents] = useState<StudentAttendance[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Fetch active term & session info
  useEffect(() => {
    async function fetchTermInfo() {
      try {
        const res = await fetch("/api/terms");
        if (res.ok) {
          const data = await res.json();
          if (data.ok) {
            if (data.current_session) setCurrentSession(data.current_session);
            if (data.current_term) setCurrentTerm(data.current_term);
          }
        }
      } catch (err) {
        console.warn("Could not fetch active term, using default session/term:", err);
      }
    }
    fetchTermInfo();
  }, []);

  const loadClasses = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) return;

      const { data: profile } = await supabase
        .from("users")
        .select("id")
        .eq("auth_id", user.id)
        .maybeSingle();

      const teacherUid = profile?.id || user.id;
      const idList = Array.from(new Set([user.id, teacherUid].filter(Boolean)));

      // 1. Check class_teacher_assignments for active class teacher duties
      let list: { id: string; name: string }[] = [];
      try {
        const { data: ctaData } = await supabase
          .from("class_teacher_assignments")
          .select("class_id, classes(id, name)")
          .in("teacher_user_id", idList)
          .eq("status", "active");

        if (ctaData && ctaData.length > 0) {
          const map = new Map<string, { id: string; name: string }>();
          ctaData.forEach((a: any) => {
            if (a.classes?.name) map.set(a.classes.id, a.classes);
          });
          list = Array.from(map.values());
        }
      } catch (ctaErr) {
        console.warn("Could not query class_teacher_assignments, checking fallback:", ctaErr);
      }

      // 2. Fallback to classes where class_teacher_id is this user
      if (!list.length) {
        const { data: ctClasses } = await supabase
          .from("classes")
          .select("id, name")
          .in("class_teacher_id", idList);
        if (ctClasses && ctClasses.length > 0) {
          list = ctClasses;
        }
      }

      // 3. Fallback to teacher_assignments
      if (!list.length) {
        const { data: assignments } = await supabase
          .from("teacher_assignments")
          .select("class_id, classes(id, name)")
          .in("teacher_user_id", idList);

        const map = new Map<string, { id: string; name: string }>();
        (assignments || []).forEach((a: any) => {
          if (a.classes?.name) map.set(a.classes.id, a.classes);
        });
        list = Array.from(map.values());
      }

      setClasses(list);
      if (list.length > 0 && !selectedClass) {
        setSelectedClass(list[0].id);
      }
    } catch (err) {
      console.error("Load teacher classes error:", err);
    }
  }, [selectedClass]);

  const loadAttendance = useCallback(async () => {
    if (!selectedClass) return;
    setLoading(true);
    try {
      const q = `/api/teacher/attendance?class_id=${encodeURIComponent(selectedClass)}&term=${encodeURIComponent(currentTerm)}&session=${encodeURIComponent(currentSession)}&date=${encodeURIComponent(selectedDate)}`;
      const res = await fetch(q);
      if (!res.ok) {
        throw new Error("Failed to load attendance from server.");
      }
      const data = await res.json();
      if (data.students) {
        setStudents(
          data.students.map((s: any) => ({
            student_id: s.student_id,
            name: s.name,
            admission_no: s.admission_no,
            am: s.am ?? true,
            pm: s.pm ?? true,
            timesPresent: s.timesPresent ?? 0,
            timesOpened: s.timesOpened || defaultTimesOpened,
          }))
        );
      } else {
        setStudents([]);
      }
    } catch (err: any) {
      console.error("Load attendance error:", err);
      setSaveStatus({
        type: "error",
        text: `Error loading attendance: ${err.message || "Unknown error"}`,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedClass, selectedDate, currentTerm, currentSession, defaultTimesOpened]);

  useEffect(() => {
    loadClasses();
  }, [loadClasses]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  // Daily Mode: Mark all present or reset
  function handleMarkAllDaily(present: boolean) {
    setStudents((prev) =>
      prev.map((s) => ({
        ...s,
        am: present,
        pm: present,
      }))
    );
  }

  // Summary Mode: Batch set all students to full attendance
  function handleMarkAllFullSummary() {
    setStudents((prev) =>
      prev.map((s) => ({
        ...s,
        timesPresent: s.timesOpened,
      }))
    );
  }

  // Summary Mode: Apply a global Times Opened to all students
  function handleSetClassTimesOpened(newOpened: number) {
    setDefaultTimesOpened(newOpened);
    setStudents((prev) =>
      prev.map((s) => ({
        ...s,
        timesOpened: newOpened,
        timesPresent: Math.min(s.timesPresent, newOpened),
      }))
    );
  }

  // Save Daily Register (via secure API)
  async function handleSaveDaily() {
    if (!students.length) return;
    setSaving(true);
    setSaveStatus(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;

      const recordsToUpsert = students.map((s) => ({
        student_id: s.student_id,
        class_id: selectedClass,
        term: currentTerm,
        session: currentSession,
        date: selectedDate,
        am_present: !!s.am,
        pm_present: !!s.pm,
        recorded_by: userId || null,
      }));

      const res = await fetch("/api/teacher/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_daily",
          records: recordsToUpsert,
          term: currentTerm,
          session: currentSession,
          class_id: selectedClass,
        }),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error || "Failed to save daily register.");
      }

      setSaveStatus({
        type: "success",
        text: `Daily register for ${selectedDate} saved! Term totals automatically synced.`,
      });
      setTimeout(() => setSaveStatus(null), 4000);
      loadAttendance();
    } catch (err: any) {
      console.error("Save daily attendance error:", err);
      setSaveStatus({
        type: "error",
        text: `Error saving daily register: ${err.message || "Unknown error"}`,
      });
    } finally {
      setSaving(false);
    }
  }

  // Save Term Summary (via secure API, strictly omitting days_opened/days_present to prevent schema errors)
  async function handleSaveSummary() {
    if (!students.length) return;
    setSaving(true);
    setSaveStatus(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;

      const payload = students.map((s) => {
        const opened = Math.max(0, s.timesOpened || defaultTimesOpened);
        const present = Math.min(opened, Math.max(0, s.timesPresent || 0));
        const absent = Math.max(0, opened - present);
        return {
          student_id: s.student_id,
          class_id: selectedClass,
          term: currentTerm,
          session: currentSession,
          times_opened: opened,
          times_present: present,
          times_absent: absent,
          recorded_by: userId || null,
        };
      });

      const res = await fetch("/api/teacher/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_summary",
          records: payload,
          term: currentTerm,
          session: currentSession,
          class_id: selectedClass,
        }),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error || "Failed to save summary.");
      }

      setSaveStatus({
        type: "success",
        text: `Term attendance summary saved! Report cards will immediately reflect these totals.`,
      });
      setTimeout(() => setSaveStatus(null), 4500);
      loadAttendance();
    } catch (err: any) {
      console.error("Save summary attendance error:", err);
      setSaveStatus({
        type: "error",
        text: `Error saving summary: ${err.message || "Unknown error"}`,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Class Attendance
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {currentSession} • {currentTerm.toUpperCase()}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {activeTab === "summary"
              ? "Fast Term Attendance: adjust term totals directly for report cards."
              : "Daily Register: record morning (AM) and afternoon (PM) attendance."}
          </p>
        </div>

        {/* Tab Switcher & Save Action */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab("summary")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === "summary"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              ⚡ Fast Term Summary
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("daily")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === "daily"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              📅 Daily Register
            </button>
          </div>

          <button
            type="button"
            onClick={activeTab === "summary" ? handleSaveSummary : handleSaveDaily}
            disabled={saving || students.length === 0}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Saving…
              </>
            ) : activeTab === "summary" ? (
              "Save Term Totals"
            ) : (
              "Save Daily Register"
            )}
          </button>
        </div>
      </div>

      {/* Notifications */}
      {saveStatus && (
        <div
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2 ${
            saveStatus.type === "error"
              ? "bg-rose-50 text-rose-700 border border-rose-200"
              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          <span>{saveStatus.type === "error" ? "⚠️" : "✓"}</span>
          <span>{saveStatus.text}</span>
        </div>
      )}

      {/* Controls Bar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Select Class
            </label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 min-w-[160px]"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {activeTab === "daily" ? (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Attendance Date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                School Days Opened (Term Total)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={defaultTimesOpened}
                  onChange={(e) => handleSetClassTimesOpened(Number(e.target.value))}
                  className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <span className="text-[11px] text-slate-500 font-medium">
                  days per term
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Quick action buttons */}
        <div className="flex items-center gap-2">
          {activeTab === "daily" ? (
            <>
              <button
                type="button"
                onClick={() => handleMarkAllDaily(true)}
                className="px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-semibold border border-emerald-200 transition-colors cursor-pointer"
              >
                Mark All Present (Full Day)
              </button>
              <button
                type="button"
                onClick={() => handleMarkAllDaily(false)}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Reset Day
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleMarkAllFullSummary}
                className="px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-semibold border border-emerald-200 transition-colors cursor-pointer"
              >
                Set All to 100% Present
              </button>
              <div className="text-[11px] text-slate-400 italic">
                *Only adjust students who missed school days
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-4 w-12 text-center">#</th>
                <th className="px-5 py-4">Student</th>
                <th className="px-4 py-4">Admission No</th>

                {activeTab === "daily" ? (
                  <>
                    <th className="px-6 py-4 text-center min-w-[130px]">Morning (AM)</th>
                    <th className="px-6 py-4 text-center min-w-[130px]">Afternoon (PM)</th>
                    <th className="px-6 py-4 text-center min-w-[150px]">Today&apos;s Count</th>
                    <th className="px-6 py-4 text-center">Term Present (Days)</th>
                    <th className="px-6 py-4 text-center">Term Opened</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-4 text-center">Days Opened</th>
                    <th className="px-4 py-4 text-center">Days Present</th>
                    <th className="px-4 py-4 text-center">Days Absent</th>
                    <th className="px-6 py-4 text-center">Attendance %</th>
                    <th className="px-4 py-4 text-center">Quick Adjust</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={activeTab === "daily" ? 8 : 8} className="px-6 py-12 text-center text-slate-400">
                    Loading student list…
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === "daily" ? 8 : 8} className="px-6 py-12 text-center text-slate-400">
                    No students found in this class.
                  </td>
                </tr>
              ) : (
                students.map((s, idx) => {
                  const pct = s.timesOpened > 0 ? Math.round((s.timesPresent / s.timesOpened) * 100) : 100;
                  const absent = Math.max(0, s.timesOpened - s.timesPresent);
                  const isDayPresent = s.am && s.pm;

                  return (
                    <tr key={s.student_id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-4 text-slate-400 font-mono text-[11px] text-center">
                        {idx + 1}
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-900">
                        {s.name}
                      </td>
                      <td className="px-4 py-4 font-mono text-slate-600 font-medium">
                        {s.admission_no}
                      </td>

                      {activeTab === "daily" ? (
                        <>
                          <td className="px-6 py-4 text-center">
                            <label className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all select-none ${
                              s.am 
                                ? "bg-indigo-50 border-indigo-200 text-indigo-700 shadow-xs" 
                                : "bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100"
                            }`}>
                              <input
                                type="checkbox"
                                checked={s.am}
                                onChange={(e) => {
                                  const updated = [...students];
                                  updated[idx].am = e.target.checked;
                                  setStudents(updated);
                                }}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                              <span>Morning</span>
                            </label>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <label className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all select-none ${
                              s.pm 
                                ? "bg-indigo-50 border-indigo-200 text-indigo-700 shadow-xs" 
                                : "bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100"
                            }`}>
                              <input
                                type="checkbox"
                                checked={s.pm}
                                onChange={(e) => {
                                  const updated = [...students];
                                  updated[idx].pm = e.target.checked;
                                  setStudents(updated);
                                }}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                              <span>Afternoon</span>
                            </label>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {isDayPresent ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span>✓</span> 1 Day Present
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200" title={!s.am && !s.pm ? "Absent all day" : !s.am ? "Missed morning session" : "Missed afternoon session"}>
                                <span>✕</span> 0 (Absent)
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center font-bold text-slate-900 text-sm">
                            {s.timesPresent}
                          </td>
                          <td className="px-6 py-4 text-center text-slate-500 font-medium">
                            {s.timesOpened}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-4 text-center">
                            <input
                              type="number"
                              min="0"
                              max="200"
                              value={s.timesOpened}
                              onChange={(e) => {
                                const updated = [...students];
                                const val = Number(e.target.value);
                                updated[idx].timesOpened = val;
                                updated[idx].timesPresent = Math.min(updated[idx].timesPresent, val);
                                setStudents(updated);
                              }}
                              className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-center font-medium text-slate-800 focus:ring-1 focus:ring-slate-900"
                            />
                          </td>
                          <td className="px-4 py-4 text-center">
                            <input
                              type="number"
                              min="0"
                              max={s.timesOpened}
                              value={s.timesPresent}
                              onChange={(e) => {
                                const updated = [...students];
                                const val = Math.min(s.timesOpened, Math.max(0, Number(e.target.value)));
                                updated[idx].timesPresent = val;
                                setStudents(updated);
                              }}
                              className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-center font-bold text-slate-900 focus:ring-1 focus:ring-slate-900"
                            />
                          </td>
                          <td className="px-4 py-4 text-center font-medium text-slate-500">
                            {absent}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                pct >= 85
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : pct >= 70
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : "bg-rose-50 text-rose-700 border border-rose-200"
                              }`}
                            >
                              {pct}%
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                title="Minus 1 day"
                                onClick={() => {
                                  const updated = [...students];
                                  updated[idx].timesPresent = Math.max(0, updated[idx].timesPresent - 1);
                                  setStudents(updated);
                                }}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                              >
                                -1
                              </button>
                              <button
                                type="button"
                                title="Full Attendance"
                                onClick={() => {
                                  const updated = [...students];
                                  updated[idx].timesPresent = updated[idx].timesOpened;
                                  setStudents(updated);
                                }}
                                className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold cursor-pointer"
                              >
                                100%
                              </button>
                            </div>
                          </td>
                        </>
                      )}
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
