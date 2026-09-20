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
  const [defaultTimesOpened, setDefaultTimesOpened] = useState(130);

  // Daily mode state
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  const [students, setStudents] = useState<StudentAttendance[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Fetch active term info
  useEffect(() => {
    async function fetchTermInfo() {
      try {
        const { data: termData } = await supabase
          .from("terms")
          .select("session, term, school_days")
          .eq("status", "open")
          .maybeSingle();

        if (termData) {
          if (termData.session) setCurrentSession(termData.session);
          if (termData.term) setCurrentTerm(termData.term);
          if (termData.school_days) setDefaultTimesOpened(termData.school_days * 2);
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

      // 1. Check class_teacher_assignments for active class teacher duties
      let list: { id: string; name: string }[] = [];
      try {
        const { data: ctaData } = await supabase
          .from("class_teacher_assignments")
          .select("class_id, classes(id, name)")
          .eq("teacher_user_id", user.id)
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
          .eq("class_teacher_id", user.id);
        if (ctClasses && ctClasses.length > 0) {
          list = ctClasses;
        }
      }

      // 3. Fallback to teacher_assignments
      if (!list.length) {
        const { data: assignments } = await supabase
          .from("teacher_assignments")
          .select("class_id, classes(id, name)")
          .eq("teacher_user_id", user.id);

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
      // 1. Fetch students from student_enrollments (or fallback to students)
      let stdData: any[] = [];
      try {
        const { data: enrollments } = await supabase
          .from("student_enrollments")
          .select("student_id, students(id, name, admission_no)")
          .eq("class_id", selectedClass)
          .eq("status", "active");

        if (enrollments && enrollments.length > 0) {
          stdData = enrollments
            .map((e: any) => e.students)
            .filter(Boolean)
            .sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
        }
      } catch (eErr) {
        console.warn("Could not query student_enrollments, falling back to students table:", eErr);
      }

      if (!stdData.length) {
        const { data: fallbackStudents } = await supabase
          .from("students")
          .select("id, name, admission_no")
          .eq("class_id", selectedClass)
          .order("name");
        stdData = fallbackStudents || [];
      }

      if (!stdData || !stdData.length) {
        setStudents([]);
        setLoading(false);
        return;
      }

      const sIds = stdData.map((s) => s.id);

      // 2. Fetch daily register records for selected date
      const { data: todayRecords } = await supabase
        .from("attendance_records")
        .select("student_id, am_present, pm_present")
        .in("student_id", sIds)
        .eq("term", currentTerm)
        .eq("session", currentSession)
        .eq("date", selectedDate);

      const recordMap = new Map<string, { am: boolean; pm: boolean }>();
      (todayRecords || []).forEach((r) => {
        recordMap.set(r.student_id, {
          am: r.am_present ?? true,
          pm: r.pm_present ?? true,
        });
      });

      // 3. Fetch term aggregate attendance (from attendance table)
      const { data: termData } = await supabase
        .from("attendance")
        .select("student_id, times_present, times_opened, days_present, days_opened")
        .in("student_id", sIds)
        .eq("term", currentTerm);

      const termMap = new Map<string, { times_present: number; times_opened: number }>();
      (termData || []).forEach((t) => {
        const opened = t.times_opened || (t.days_opened ? t.days_opened * 2 : defaultTimesOpened);
        const present = t.times_present ?? (t.days_present ? t.days_present * 2 : opened);
        termMap.set(t.student_id, {
          times_present: present,
          times_opened: opened,
        });
      });

      const list: StudentAttendance[] = stdData.map((s) => {
        const rec = recordMap.get(s.id);
        const term = termMap.get(s.id);
        const opened = term?.times_opened ?? defaultTimesOpened;
        const present = term?.times_present ?? opened; // default full attendance for convenience
        return {
          student_id: s.id,
          name: s.name,
          admission_no: s.admission_no,
          am: rec?.am ?? true,
          pm: rec?.pm ?? true,
          timesPresent: present,
          timesOpened: opened,
        };
      });

      setStudents(list);
    } catch (err) {
      console.error("Load attendance error:", err);
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

  // Save Daily Register (attendance_records table)
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

      const { error } = await supabase
        .from("attendance_records")
        .upsert(recordsToUpsert, { onConflict: "student_id,term,session,date" });

      if (error) throw error;

      setSaveStatus({
        type: "success",
        text: `Daily register for ${selectedDate} saved successfully!`,
      });
      setTimeout(() => setSaveStatus(null), 4000);
    } catch (err: any) {
      console.error("Save daily attendance error:", err);
      setSaveStatus({
        type: "error",
        text: `Error saving daily register: ${err.message || err.details || "Unknown error"}`,
      });
    } finally {
      setSaving(false);
    }
  }

  // Save Term Summary (attendance table used by Report Cards)
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
          days_opened: Math.round(opened / 2),
          days_present: Math.round(present / 2),
          days_absent: Math.round(absent / 2),
          recorded_by: userId || null,
        };
      });

      const { error } = await supabase
        .from("attendance")
        .upsert(payload, { onConflict: "student_id,term" });

      if (error) throw error;

      setSaveStatus({
        type: "success",
        text: `Term attendance summary saved! Report cards will immediately reflect these totals.`,
      });
      setTimeout(() => setSaveStatus(null), 4500);
    } catch (err: any) {
      console.error("Save summary attendance error:", err);
      setSaveStatus({
        type: "error",
        text: `Error saving summary: ${err.message || err.details || "Unknown error"}`,
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
                School Days Opened (Sessions)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={defaultTimesOpened}
                  onChange={(e) => handleSetClassTimesOpened(Number(e.target.value))}
                  className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <span className="text-[11px] text-slate-500 font-medium">
                  sessions (~{Math.round(defaultTimesOpened / 2)} days)
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
                className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-semibold border border-emerald-200 transition-colors cursor-pointer"
              >
                Mark All Present Today
              </button>
              <button
                type="button"
                onClick={() => handleMarkAllDaily(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Reset Day
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleMarkAllFullSummary}
                className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-semibold border border-emerald-200 transition-colors cursor-pointer"
              >
                Set All to 100% Present
              </button>
              <div className="text-[11px] text-slate-400 italic">
                *Only adjust students who missed sessions
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3.5">#</th>
                <th className="px-6 py-3.5">Student</th>
                <th className="px-4 py-3.5">Admission No</th>

                {activeTab === "daily" ? (
                  <>
                    <th className="px-4 py-3.5 text-center">Morning (AM)</th>
                    <th className="px-4 py-3.5 text-center">Afternoon (PM)</th>
                    <th className="px-6 py-3.5 text-center">Term Total Present</th>
                    <th className="px-6 py-3.5 text-center">Term Total Opened</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-3.5 text-center">Times Opened</th>
                    <th className="px-4 py-3.5 text-center">Times Present</th>
                    <th className="px-4 py-3.5 text-center">Times Absent</th>
                    <th className="px-6 py-3.5 text-center">Attendance %</th>
                    <th className="px-4 py-3.5 text-center">Quick Adjust</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={activeTab === "daily" ? 7 : 8} className="px-6 py-12 text-center text-slate-400">
                    Loading student list…
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === "daily" ? 7 : 8} className="px-6 py-12 text-center text-slate-400">
                    No students found in this class.
                  </td>
                </tr>
              ) : (
                students.map((s, idx) => {
                  const pct = s.timesOpened > 0 ? Math.round((s.timesPresent / s.timesOpened) * 100) : 100;
                  const absent = Math.max(0, s.timesOpened - s.timesPresent);

                  return (
                    <tr key={s.student_id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-3.5 text-slate-400 font-mono text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="px-6 py-3.5 font-bold text-slate-900">
                        {s.name}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-600 font-medium">
                        {s.admission_no}
                      </td>

                      {activeTab === "daily" ? (
                        <>
                          <td className="px-4 py-3.5 text-center">
                            <input
                              type="checkbox"
                              checked={s.am}
                              onChange={(e) => {
                                const updated = [...students];
                                updated[idx].am = e.target.checked;
                                setStudents(updated);
                              }}
                              className="w-4 h-4 rounded text-slate-900 focus:ring-slate-900 cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <input
                              type="checkbox"
                              checked={s.pm}
                              onChange={(e) => {
                                const updated = [...students];
                                updated[idx].pm = e.target.checked;
                                setStudents(updated);
                              }}
                              className="w-4 h-4 rounded text-slate-900 focus:ring-slate-900 cursor-pointer"
                            />
                          </td>
                          <td className="px-6 py-3.5 text-center font-bold text-slate-900">
                            {s.timesPresent}
                          </td>
                          <td className="px-6 py-3.5 text-center text-slate-500">
                            {s.timesOpened}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3.5 text-center">
                            <input
                              type="number"
                              min="0"
                              max="300"
                              value={s.timesOpened}
                              onChange={(e) => {
                                const updated = [...students];
                                const val = Number(e.target.value);
                                updated[idx].timesOpened = val;
                                updated[idx].timesPresent = Math.min(updated[idx].timesPresent, val);
                                setStudents(updated);
                              }}
                              className="w-18 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-center font-medium text-slate-800 focus:ring-1 focus:ring-slate-900"
                            />
                          </td>
                          <td className="px-4 py-3.5 text-center">
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
                              className="w-18 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-center font-bold text-slate-900 focus:ring-1 focus:ring-slate-900"
                            />
                          </td>
                          <td className="px-4 py-3.5 text-center font-medium text-slate-500">
                            {absent}
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
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
                          <td className="px-4 py-3.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                title="Minus 2 sessions (1 day)"
                                onClick={() => {
                                  const updated = [...students];
                                  updated[idx].timesPresent = Math.max(0, updated[idx].timesPresent - 2);
                                  setStudents(updated);
                                }}
                                className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-bold cursor-pointer"
                              >
                                -2
                              </button>
                              <button
                                type="button"
                                title="Full Attendance"
                                onClick={() => {
                                  const updated = [...students];
                                  updated[idx].timesPresent = updated[idx].timesOpened;
                                  setStudents(updated);
                                }}
                                className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-[11px] font-bold cursor-pointer"
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
