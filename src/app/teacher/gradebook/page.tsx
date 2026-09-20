"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";

export default function TeacherGradebookPage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [term, setTerm] = useState("term1");
  const [session, setSession] = useState("2025/2026");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // 1. Initial Load: App term settings & teacher assigned classes
  useEffect(() => {
    async function init() {
      try {
        // Fetch active term & session
        const res = await fetch("/api/terms");
        if (res.ok) {
          const tData = await res.json();
          if (tData.current_session) setSession(tData.current_session);
          if (tData.current_term) setTerm(tData.current_term);
        }

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
        const classMap = new Map<string, { id: string; name: string }>();

        // 1. Check class_teacher_assignments
        try {
          const { data: cta } = await supabase
            .from("class_teacher_assignments")
            .select("class_id, classes(id, name)")
            .in("teacher_user_id", idList)
            .eq("status", "active");
          (cta || []).forEach((a: any) => {
            if (a.classes?.id && a.classes?.name) classMap.set(a.classes.id, a.classes);
          });
        } catch (e) {
          console.warn("CTA lookup failed in gradebook:", e);
        }

        // 2. Check classes where class_teacher_id matches
        try {
          const { data: ctClasses } = await supabase
            .from("classes")
            .select("id, name")
            .in("class_teacher_id", idList);
          (ctClasses || []).forEach((c: any) => {
            if (c?.id && c?.name) classMap.set(c.id, c);
          });
        } catch (e) {
          console.warn("classes lookup failed in gradebook:", e);
        }

        // 3. Fallback: teacher_assignments
        try {
          const { data: assignments } = await supabase
            .from("teacher_assignments")
            .select("class_id, classes(id, name)")
            .in("teacher_user_id", idList);
          (assignments || []).forEach((a: any) => {
            if (a.classes?.id && a.classes?.name) classMap.set(a.classes.id, a.classes);
          });
        } catch (e) {
          // fallback
        }

        // 4. Fallback: if no class teacher assignment found, query classes for selection
        if (!classMap.size) {
          const { data: allClasses } = await supabase.from("classes").select("id, name").order("name");
          (allClasses || []).forEach((c) => classMap.set(c.id, c));
        }

        const classList = Array.from(classMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        setClasses(classList);
        if (classList.length > 0) {
          setSelectedClass(classList[0].id);
        }
      } catch (err) {
        console.error("Gradebook init error:", err);
      }
    }

    init();
  }, []);

  // 2. Load subjects for selected class
  useEffect(() => {
    if (!selectedClass) return;

    async function loadSubjects() {
      try {
        const { data: subData } = await supabase
          .from("subjects")
          .select("id, name")
          .order("name");

        const list = subData || [];
        setSubjects(list);
        if (list.length > 0 && !selectedSubject) {
          setSelectedSubject(list[0].id);
        }
      } catch (err) {
        console.error("Load subjects error:", err);
      }
    }

    loadSubjects();
  }, [selectedClass, selectedSubject]);

  // 3. Load gradebook results
  const loadResults = useCallback(async () => {
    if (!selectedClass) return;
    setLoading(true);
    try {
      let q = supabase
        .from("results")
        .select("id, subject_id, cw, hw, test, project, exam, total, grade, remark, status, students(id, name, admission_no), subjects(name)")
        .eq("class_id", selectedClass)
        .eq("term", term);

      if (session) {
        q = q.eq("session", session);
      }

      if (selectedSubject) {
        q = q.eq("subject_id", selectedSubject);
      }

      const { data, error } = await q.order("total", { ascending: false });
      if (error) throw error;

      setResults(data || []);
    } catch (err) {
      console.error("Load gradebook results error:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedClass, selectedSubject, term, session]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  const scores = results.map((r) => Number(r.total) || 0).filter((n) => n > 0);
  const avg = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0;
  const high = scores.length ? Math.max(...scores) : 0;
  const low = scores.length ? Math.min(...scores) : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Class Teacher Gradebook
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {session} • {term.toUpperCase()}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Master grade sheet and score distribution for your assigned class.
          </p>
        </div>
      </div>

      {/* Selectors */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1 w-48">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Assigned Class
          </label>
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            {classes.length === 0 ? (
              <option value="">No classes assigned</option>
            ) : (
              classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex flex-col gap-1 w-48">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Subject
          </label>
          <select
            value={selectedSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <option value="">All Subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 w-36">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Term
          </label>
          <select
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <option value="term1">1st Term</option>
            <option value="term2">2nd Term</option>
            <option value="term3">3rd Term</option>
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
                {!selectedSubject && <th className="px-4 py-3.5">Subject</th>}
                <th className="px-3 py-3.5 text-center">CW (/10)</th>
                <th className="px-3 py-3.5 text-center">HW (/5)</th>
                <th className="px-3 py-3.5 text-center">Tests (/10)</th>
                <th className="px-3 py-3.5 text-center">Prj (/5)</th>
                <th className="px-3 py-3.5 text-center">Exam (/70)</th>
                <th className="px-4 py-3.5 text-center">Total (/100)</th>
                <th className="px-4 py-3.5 text-center">Grade</th>
                <th className="px-4 py-3.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={selectedSubject ? 10 : 11} className="px-6 py-12 text-center text-slate-400">
                    Loading results…
                  </td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={selectedSubject ? 10 : 11} className="px-6 py-12 text-center text-slate-400">
                    No results recorded for this class in {term.toUpperCase()} ({session}).
                  </td>
                </tr>
              ) : (
                results.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3.5 font-bold text-slate-900">
                      {r.students?.name || "Student"}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-600">
                      {r.students?.admission_no || "—"}
                    </td>
                    {!selectedSubject && (
                      <td className="px-4 py-3.5 font-medium text-slate-800">
                        {r.subjects?.name || "Subject"}
                      </td>
                    )}
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
                    <td className="px-4 py-3.5 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          r.status === "approved" || r.status === "published"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : r.status === "submitted"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {r.status || "draft"}
                      </span>
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
