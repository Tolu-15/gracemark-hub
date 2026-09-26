"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { StudentRecord, ClassRecord } from "@/types/database";

export default function AdminStudentAccessPage() {
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterClass, setFilterClass] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: classesData }, { data: studentsData, error: sErr }] = await Promise.all([
        supabase.from("classes").select("id, name").order("name", { ascending: true }),
        supabase
          .from("students")
          .select("id, name, admission_no, class_id, portal_access_status, portal_lock_reason, classes:class_id(name)")
          .order("name", { ascending: true }),
      ]);

      if (sErr) throw sErr;
      setClasses(classesData || []);
      setStudents(studentsData || []);
    } catch (err) {
      console.error("Failed to load student access statuses:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleToggleAccess(student: StudentRecord) {
    const isCurrentlyLocked = student.portal_access_status === "locked";
    let newReason: string | null = null;

    if (!isCurrentlyLocked) {
      const input = prompt(
        `Enter lock reason for "${student.name}" (or leave blank for "Outstanding school fees"):`,
        "Outstanding school fees"
      );
      if (input === null) return; // User cancelled
      newReason = input.trim() || "Outstanding school fees";
    }

    setUpdatingId(student.id);
    try {
      const newStatus = isCurrentlyLocked ? "active" : "locked";
      const { error } = await supabase
        .from("students")
        .update({
          portal_access_status: newStatus,
          portal_lock_reason: newStatus === "locked" ? newReason : null,
        })
        .eq("id", student.id);

      if (error) throw error;
      await loadData();
    } catch (err: any) {
      console.error("Toggle access error:", err);
      alert(`Failed to update access: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  }

  const filteredStudents = students.filter((s) => {
    if (filterClass && s.class_id !== filterClass) return false;
    if (filterStatus && s.portal_access_status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = (s.name || "").toLowerCase().includes(q);
      const matchAdm = (s.admission_no || "").toLowerCase().includes(q);
      return matchName || matchAdm;
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Student Portal Access Control
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Lock or unlock student access to results and dashboards based on fee payments or administrative holds.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by student name or admission number…"
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
          />
        </div>

        <div className="w-48 shrink-0">
          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
          >
            <option value="">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="w-44 shrink-0">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
          >
            <option value="">All Statuses</option>
            <option value="active">Active (Unlocked)</option>
            <option value="locked">Locked</option>
          </select>
        </div>
      </div>

      {/* Access Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3.5">Student</th>
                <th className="px-4 py-3.5">Admission No</th>
                <th className="px-4 py-3.5">Class</th>
                <th className="px-4 py-3.5">Current Status</th>
                <th className="px-6 py-3.5">Lock Reason</th>
                <th className="px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    Loading student access states…
                  </td>
                </tr>
              ) : filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    No students match your filter.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((s) => {
                  const isLocked = s.portal_access_status === "locked";
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-3.5 font-bold text-slate-900">
                        {s.name}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-600 font-medium">
                        {s.admission_no}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate-800">
                        {s.classes?.name || "Unassigned"}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                            isLocked
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                          }`}
                        >
                          {isLocked ? "Locked" : "Active"}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-slate-500 italic">
                        {isLocked ? s.portal_lock_reason || "Unpaid school fees" : "—"}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <button
                          type="button"
                          disabled={updatingId === s.id}
                          onClick={() => handleToggleAccess(s)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer disabled:opacity-50 ${
                            isLocked
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                              : "bg-rose-600 hover:bg-rose-700 text-white"
                          }`}
                        >
                          {updatingId === s.id
                            ? "Updating…"
                            : isLocked
                            ? "Unlock Portal"
                            : "Lock Portal"}
                        </button>
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
