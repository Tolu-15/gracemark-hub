"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import { getAcademicSessions } from "@/lib/academicSessions";
import { getAppSettings } from "@/lib/appSettings";

/**
 * Read-only view of the same "Class Teacher Gradebook" teachers see while
 * entering scores — CW/HW/Test/Project/Exam breakdown and each result's
 * draft/submitted/approved status, for oversight of score-entry progress.
 * Admin has no write controls here; it's the same display-only page
 * teachers use, just unrestricted to any class instead of only assigned ones.
 */
export default function AdminTeacherGradebookPage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [term, setTerm] = useState("term1");
  const [sessions, setSessions] = useState<string[]>([]);
  const [session, setSession] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const loadSeqRef = React.useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: classData }, { data: subData }, academicSessions, settings] = await Promise.all([
          supabase.from("classes").select("id, name").order("display_order"),
          supabase.from("subjects").select("id, name").order("name"),
          getAcademicSessions(),
          getAppSettings(),
        ]);
        setClasses(classData || []);
        setSubjects(subData || []);
        if (classData?.length) setSelectedClass(classData[0].id);

        const sessionNames = academicSessions.map((s) => s.name);
        setSessions(sessionNames);
        setSession(settings?.current_session || sessionNames[0] || "");
        if (settings?.current_term) setTerm(settings.current_term);
      } catch (err) {
        console.error("Admin gradebook init error:", err);
      }
    })();
  }, []);

  const loadResults = useCallback(async () => {
    if (!selectedClass) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const url = new URL("/api/teacher/gradebook", window.location.origin);
      url.searchParams.set("class_id", selectedClass);
      url.searchParams.set("term", term);
      if (session) url.searchParams.set("session", session);
      if (selectedSubject) url.searchParams.set("subject_id", selectedSubject);

      const res = await fetch(url.toString(), { headers: await getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch gradebook from server.");
      const data = await res.json();
      if (loadSeqRef.current !== seq) return;
      setResults(data.results || []);
    } catch (err) {
      console.error("Load gradebook results error:", err);
      if (loadSeqRef.current === seq) setResults([]);
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [selectedClass, selectedSubject, term, session]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  const scores = results.map((r) => Number(r.total) || 0).filter((n) => n > 0);
  const avg = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0;

  const subjectHighLow = useMemo(() => {
    const bySubject = new Map<string, { name: string; rows: { name: string; total: number }[] }>();
    results.forEach((r) => {
      const total = Number(r.total) || 0;
      if (total <= 0) return;
      const key = r.subject_id || r.subjects?.name || "subject";
      const entry = bySubject.get(key) || { name: r.subjects?.name || "Subject", rows: [] as { name: string; total: number }[] };
      entry.rows.push({ name: r.students?.name || "Student", total });
      bySubject.set(key, entry);
    });
    return Array.from(bySubject.values())
      .map(({ name, rows }) => {
        const max = Math.max(...rows.map((r) => r.total));
        const min = Math.min(...rows.map((r) => r.total));
        return {
          name,
          highest: { score: max, names: rows.filter((r) => r.total === max).map((r) => r.name) },
          lowest: { score: min, names: rows.filter((r) => r.total === min).map((r) => r.name) },
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [results]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Teacher Gradebook</h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Read-only</span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {session} • {term.toUpperCase()}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            The same CW/HW/Test/Project/Exam breakdown and entry status teachers see for a class, for any class — view-only.
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1 w-48">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Class</label>
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            {classes.length === 0 ? (
              <option value="">No classes</option>
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
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Subject</label>
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
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Term</label>
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

        <div className="flex flex-col gap-1 w-36">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Session</label>
          <select
            value={session}
            onChange={(e) => setSession(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            {sessions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs w-full sm:w-64">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Class Average</span>
        <span className="text-2xl font-black text-slate-900">{avg} / 100</span>
      </div>

      {subjectHighLow.length > 0 && (
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Highest &amp; Lowest, per Subject</span>
          </div>
          <div className="divide-y divide-slate-100">
            {subjectHighLow.map((s) => (
              <div key={s.name} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3">
                <span className="text-sm font-semibold text-slate-700 w-full sm:w-40 shrink-0">{s.name}</span>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-semibold">
                    Highest: {s.highest.names.join(", ")} — {s.highest.score}/100
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-semibold">
                    Lowest: {s.lowest.names.join(", ")} — {s.lowest.score}/100
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                    <td className="px-6 py-3.5 font-bold text-slate-900">{r.students?.name || "Student"}</td>
                    <td className="px-4 py-3.5 font-mono text-slate-600">{r.students?.admission_no || "—"}</td>
                    {!selectedSubject && <td className="px-4 py-3.5 font-medium text-slate-800">{r.subjects?.name || "Subject"}</td>}
                    <td className="px-3 py-3.5 text-center">{r.cw ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.hw ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.test ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.project ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.exam ?? 0}</td>
                    <td className="px-4 py-3.5 text-center font-bold text-slate-900">{r.total ?? 0}</td>
                    <td className="px-4 py-3.5 text-center font-bold text-emerald-700">{r.grade || "—"}</td>
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
