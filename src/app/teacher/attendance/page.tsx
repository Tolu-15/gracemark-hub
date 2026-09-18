"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";

interface StudentAttendance {
  student_id: string;
  name: string;
  admission_no: string;
  am: boolean;
  pm: boolean;
  termPresent: number;
  termOpened: number;
}

export default function TeacherAttendancePage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [students, setStudents] = useState<StudentAttendance[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  const loadClasses = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) return;

      const { data: assignments } = await supabase
        .from("teacher_assignments")
        .select("class_id, classes(id, name)")
        .eq("teacher_user_id", user.id);

      const map = new Map<string, { id: string; name: string }>();
      (assignments || []).forEach((a: any) => {
        if (a.classes?.name) map.set(a.classes.id, a.classes);
      });

      let list = Array.from(map.values());
      if (!list.length) {
        // Fallback: load all classes
        const { data: all } = await supabase.from("classes").select("id, name").order("name");
        list = all || [];
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
      // 1. Fetch students in class
      const { data: stdData } = await supabase
        .from("students")
        .select("id, name, admission_no")
        .eq("class_id", selectedClass)
        .order("name");

      if (!stdData || !stdData.length) {
        setStudents([]);
        setLoading(false);
        return;
      }

      const sIds = stdData.map((s) => s.id);

      // 2. Fetch today's records
      const { data: todayRecords } = await supabase
        .from("attendance_records")
        .select("student_id, am_status, pm_status")
        .in("student_id", sIds)
        .eq("date", selectedDate);

      const recordMap = new Map<string, { am: boolean; pm: boolean }>();
      (todayRecords || []).forEach((r) => {
        recordMap.set(r.student_id, {
          am: r.am_status === "present",
          pm: r.pm_status === "present",
        });
      });

      // 3. Fetch term aggregate attendance
      const { data: termData } = await supabase
        .from("attendance")
        .select("student_id, days_present, days_opened")
        .in("student_id", sIds);

      const termMap = new Map<string, { days_present: number; days_opened: number }>();
      (termData || []).forEach((t) => {
        termMap.set(t.student_id, {
          days_present: t.days_present || 0,
          days_opened: t.days_opened || 0,
        });
      });

      const list: StudentAttendance[] = stdData.map((s) => {
        const rec = recordMap.get(s.id);
        const term = termMap.get(s.id);
        return {
          student_id: s.id,
          name: s.name,
          admission_no: s.admission_no,
          am: rec?.am ?? true, // default true
          pm: rec?.pm ?? true,
          termPresent: term?.days_present ?? 0,
          termOpened: term?.days_opened ?? 0,
        };
      });

      setStudents(list);
    } catch (err) {
      console.error("Load attendance error:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedClass, selectedDate]);

  useEffect(() => {
    loadClasses();
  }, [loadClasses]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  function handleMarkAll(present: boolean) {
    setStudents((prev) =>
      prev.map((s) => ({
        ...s,
        am: present,
        pm: present,
      }))
    );
  }

  async function handleSaveAttendance() {
    if (!students.length) return;
    setSaving(true);
    setSaveStatus("");

    try {
      const recordsToUpsert = students.map((s) => ({
        student_id: s.student_id,
        date: selectedDate,
        am_status: s.am ? "present" : "absent",
        pm_status: s.pm ? "present" : "absent",
      }));

      const { error } = await supabase
        .from("attendance_records")
        .upsert(recordsToUpsert, { onConflict: "student_id,date" });

      if (error) throw error;

      setSaveStatus("Attendance saved successfully!");
      setTimeout(() => setSaveStatus(""), 3500);
    } catch (err: any) {
      console.error("Save attendance error:", err);
      setSaveStatus(`Error saving: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Daily Student Attendance
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Record morning (AM) and afternoon (PM) attendance per class.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSaveAttendance}
            disabled={saving || students.length === 0}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? "Saving…" : "Save Attendance"}
          </button>
        </div>
      </div>

      {saveStatus && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold ${
            saveStatus.startsWith("Error")
              ? "bg-rose-50 text-rose-700 border border-rose-200"
              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          {saveStatus}
        </div>
      )}

      {/* Class & Date Controls */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Select Class
            </label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

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
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleMarkAll(true)}
            className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-semibold border border-emerald-200 transition-colors cursor-pointer"
          >
            Mark All Present
          </button>
          <button
            type="button"
            onClick={() => handleMarkAll(false)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Reset Day
          </button>
        </div>
      </div>

      {/* Attendance Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3.5">Student</th>
                <th className="px-4 py-3.5">Admission No</th>
                <th className="px-4 py-3.5 text-center">Morning (AM)</th>
                <th className="px-4 py-3.5 text-center">Afternoon (PM)</th>
                <th className="px-6 py-3.5 text-center">Term Present</th>
                <th className="px-6 py-3.5 text-center">Term Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    Loading student list…
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    No students found in this class.
                  </td>
                </tr>
              ) : (
                students.map((s, idx) => (
                  <tr key={s.student_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3.5 font-bold text-slate-900">
                      {s.name}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-600 font-medium">
                      {s.admission_no}
                    </td>
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
                      {s.termPresent}
                    </td>
                    <td className="px-6 py-3.5 text-center text-slate-500">
                      {s.termOpened}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
