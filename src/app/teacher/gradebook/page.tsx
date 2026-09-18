"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";

export default function TeacherGradebookPage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadClassesAndSubjects = useCallback(async () => {
    try {
      const [{ data: clData }, { data: subData }] = await Promise.all([
        supabase.from("classes").select("id, name").order("name"),
        supabase.from("subjects").select("id, name").order("name"),
      ]);

      setClasses(clData || []);
      setSubjects(subData || []);
      if (clData?.length) setSelectedClass(clData[0].id);
      if (subData?.length) setSelectedSubject(subData[0].id);
    } catch (err) {
      console.error("Load classes/subjects error:", err);
    }
  }, []);

  const loadResults = useCallback(async () => {
    if (!selectedClass || !selectedSubject) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("results")
        .select("id, cw, hw, test, project, exam, total, grade, remark, students(id, name, admission_no)")
        .eq("class_id", selectedClass)
        .eq("subject_id", selectedSubject)
        .order("total", { ascending: false });

      setResults(data || []);
    } catch (err) {
      console.error("Load gradebook results error:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedClass, selectedSubject]);

  useEffect(() => {
    loadClassesAndSubjects();
  }, [loadClassesAndSubjects]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  const scores = results.map((r) => Number(r.total) || 0).filter((n) => n > 0);
  const avg = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0;
  const high = scores.length ? Math.max(...scores) : 0;
  const low = scores.length ? Math.min(...scores) : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          Class Gradebook & Analytics
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Review student performance distribution, class averages, and subject benchmarks.
        </p>
      </div>

      {/* Selectors */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1 w-48">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Class
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

        <div className="flex flex-col gap-1 w-56">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Subject
          </label>
          <select
            value={selectedSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Benchmarks Header Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
            Class Average
          </span>
          <span className="text-2xl font-black text-slate-900">{avg} / 100</span>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 block mb-1">
            Highest Score
          </span>
          <span className="text-2xl font-black text-emerald-700">{high} / 100</span>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-600 block mb-1">
            Lowest Score
          </span>
          <span className="text-2xl font-black text-amber-700">{low} / 100</span>
        </div>
      </div>

      {/* Scores Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3.5">Student</th>
                <th className="px-4 py-3.5">Admission No</th>
                <th className="px-3 py-3.5 text-center">CW (/10)</th>
                <th className="px-3 py-3.5 text-center">HW (/5)</th>
                <th className="px-3 py-3.5 text-center">Tests (/10)</th>
                <th className="px-3 py-3.5 text-center">Prj (/5)</th>
                <th className="px-3 py-3.5 text-center">Exam (/70)</th>
                <th className="px-4 py-3.5 text-center">Total (/100)</th>
                <th className="px-4 py-3.5 text-center">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    Loading results…
                  </td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    No results found for this class and subject.
                  </td>
                </tr>
              ) : (
                results.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3.5 font-bold text-slate-900">
                      {r.students?.name}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-600">
                      {r.students?.admission_no}
                    </td>
                    <td className="px-3 py-3.5 text-center">{r.cw ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.hw ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.test ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.project ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.exam ?? 0}</td>
                    <td className="px-4 py-3.5 text-center font-bold text-slate-900">
                      {r.total ?? 0}
                    </td>
                    <td className="px-4 py-3.5 text-center font-bold text-emerald-700">
                      {r.grade || "—"}
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
