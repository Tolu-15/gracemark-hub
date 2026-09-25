"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import ResultDashboardApp from "@/components/student/ResultDashboardApp";
import { fetchStudentReport } from "@/lib/studentReport";
import { getAcademicSessions } from "@/lib/academicSessions";
import { getAppSettings } from "@/lib/appSettings";

type ActiveTab = "student-results" | "class-broadsheet";
type BroadsheetViewMode = "score-grade" | "score-only" | "breakdown";

export default function AdminHistoricalResultsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("student-results");

  // Catalog state
  const [sessions, setSessions] = useState<string[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [currentSession, setCurrentSession] = useState("2025/2026");

  // Tab 1: Student Results Lookup State
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [studentCareer, setStudentCareer] = useState<any | null>(null);
  const [loadingCareer, setLoadingCareer] = useState(false);

  // Individual Report Card Print Modal
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printReportData, setPrintReportData] = useState<any | null>(null);
  const [loadingReportData, setLoadingReportData] = useState(false);

  // Tab 2: Class Master Broadsheet State
  const [selectedBroadsheetSession, setSelectedBroadsheetSession] = useState("");
  const [selectedBroadsheetClass, setSelectedBroadsheetClass] = useState("");
  const [selectedBroadsheetTerm, setSelectedBroadsheetTerm] = useState("term1");
  const [viewMode, setViewMode] = useState<BroadsheetViewMode>("score-grade");
  const [broadsheetData, setBroadsheetData] = useState<any | null>(null);
  const [loadingBroadsheet, setLoadingBroadsheet] = useState(false);
  const [broadsheetError, setBroadsheetError] = useState("");

  // Load Base Catalogs
  useEffect(() => {
    async function init() {
      try {
        const [sessList, settings, classesRes] = await Promise.all([
          getAcademicSessions(),
          getAppSettings(),
          supabase.from("classes").select("id, name").order("name", { ascending: true }),
        ]);

        const sNames = (sessList || []).map((s: { name: string }) => s.name);
        setSessions(sNames);

        const activeSess = settings?.current_session || sNames[0] || "2025/2026";
        setCurrentSession(activeSess);
        setSelectedBroadsheetSession(activeSess);

        if (classesRes.data && classesRes.data.length > 0) {
          setClasses(classesRes.data);
          setSelectedBroadsheetClass(classesRes.data[0].id);
        }
      } catch (err) {
        console.error("Failed to load initial metadata:", err);
      }
    }
    init();
  }, []);

  // Search students for Student Results lookup
  const handleSearchStudents = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q.trim() || q.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/admin/historical-lookup?q=${encodeURIComponent(q.trim())}`, {
        headers: await getAuthHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          setSearchResults(json.matches || []);
        }
      }
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Select student & load career results
  const handleSelectStudent = useCallback(async (sId: string) => {
    setSelectedStudentId(sId);
    setSearchResults([]);
    setLoadingCareer(true);
    try {
      const res = await fetch(`/api/admin/historical-lookup?studentId=${encodeURIComponent(sId)}`, {
        headers: await getAuthHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          setStudentCareer(json);
        }
      }
    } catch (err) {
      console.error("Career load error:", err);
    } finally {
      setLoadingCareer(false);
    }
  }, []);

  // Open & Print Individual Historical Report Card
  async function handleOpenIndividualReport(sessionName: string, termName: string, historicalClass: { id?: string; name: string }) {
    if (!studentCareer?.student) return;
    setLoadingReportData(true);
    setPrintModalOpen(true);
    try {
      const rep = await fetchStudentReport({
        student: studentCareer.student,
        term: termName,
        session: sessionName,
        historicalClassId: historicalClass.id,
        historicalClassName: historicalClass.name,
      });
      setPrintReportData(rep);
    } catch (err: any) {
      alert(`Error loading report card: ${err.message}`);
      setPrintModalOpen(false);
    } finally {
      setLoadingReportData(false);
    }
  }

  // Load Class Broadsheet
  async function handleLoadBroadsheet() {
    if (!selectedBroadsheetClass || !selectedBroadsheetSession) {
      alert("Please select both a Session and a Class.");
      return;
    }
    setLoadingBroadsheet(true);
    setBroadsheetError("");
    setBroadsheetData(null);

    try {
      const res = await fetch(
        `/api/admin/class-broadsheet?classId=${encodeURIComponent(selectedBroadsheetClass)}&session=${encodeURIComponent(selectedBroadsheetSession)}&term=${encodeURIComponent(selectedBroadsheetTerm)}`,
        { headers: await getAuthHeaders() }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load broadsheet");
      }
      setBroadsheetData(json);
    } catch (err: any) {
      setBroadsheetError(err.message);
    } finally {
      setLoadingBroadsheet(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
              Official Academic Records
            </span>
            <span className="text-xs text-slate-400 font-medium">Single Source of Truth</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mt-1">
            Student Results &amp; Master Broadsheets
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Lookup any student&apos;s academic results across past sessions, print terminal reports with historical class binding, or generate official class broadsheets.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center p-1 bg-slate-100 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("student-results")}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === "student-results"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Student Results
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("class-broadsheet")}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === "class-broadsheet"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Class Master Broadsheet
          </button>
        </div>
      </div>

      {/* TAB 1: Student Results Lookup */}
      {activeTab === "student-results" && (
        <div className="space-y-6">
          {/* Search Box */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs relative print:hidden">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Student Admission No or Name Lookup
            </label>
            <div className="relative">
              <svg
                className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchStudents(e.target.value)}
                placeholder="Type student name or admission number (e.g. GMA1701)…"
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all"
              />
              {isSearching && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-semibold animate-pulse">
                  Searching…
                </div>
              )}
            </div>

            {/* Live Matches Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute left-6 right-6 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-60 overflow-y-auto divide-y divide-slate-100">
                {searchResults.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => handleSelectStudent(st.id)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <div className="font-bold text-sm text-slate-900">{st.name}</div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        Adm No: {st.admission_no} &bull; Current Class: {st.classes?.name || "Unassigned"}
                      </div>
                    </div>
                    <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg">
                      View Results &rarr;
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Student Results Profile View */}
          {loadingCareer ? (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-12 text-center text-slate-400">
              Loading student results timeline…
            </div>
          ) : studentCareer ? (
            <div className="space-y-6">
              {/* Comprehensive Identity Card */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-600 text-white font-black text-2xl flex items-center justify-center shrink-0 shadow-md">
                    {studentCareer.student.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight">
                      {studentCareer.student.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                      <span className="font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                        {studentCareer.student.admission_no}
                      </span>
                      <span className="text-slate-400">&bull;</span>
                      <span className="font-semibold text-slate-600">
                        Current Placement: <strong className="text-slate-900">{studentCareer.currentClass}</strong>
                      </span>
                      {studentCareer.student.gender && (
                        <>
                          <span className="text-slate-400">&bull;</span>
                          <span className="text-slate-600">Gender: {studentCareer.student.gender === "M" ? "Male" : "Female"}</span>
                        </>
                      )}
                    </div>
                    {studentCareer.student.guardian_name && (
                      <p className="text-xs text-slate-500 mt-1">
                        Parent/Guardian: <strong className="text-slate-700">{studentCareer.student.guardian_name}</strong>
                        {studentCareer.student.guardian_phone ? ` (${studentCareer.student.guardian_phone})` : ""}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Enrolled Sessions
                    </span>
                    <span className="text-2xl font-black text-slate-900">
                      {studentCareer.history.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Career Sessions Timeline */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                    Academic Trajectory &amp; Session Records
                  </h4>
                  <span className="text-xs text-slate-500 font-medium">
                    Strictly bound to historical class &amp; subjects
                  </span>
                </div>

                {studentCareer.history.length === 0 ? (
                  <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-500 text-xs">
                    No session records found for this student.
                  </div>
                ) : (
                  studentCareer.history.map((sess: any) => (
                    <div
                      key={sess.session}
                      className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-4 hover:border-slate-300 transition-colors"
                    >
                      {/* Session Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <span className="text-base font-extrabold text-slate-900 font-mono">
                              {sess.session}
                            </span>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              Historical Class: {sess.historicalClass.name}
                            </span>
                            {sess.annualAverage !== null && (
                              <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Annual Avg: {sess.annualAverage}%
                              </span>
                            )}
                          </div>
                          {sess.promotionDetails && (
                            <p className="text-xs text-emerald-700 font-semibold mt-1">
                              &bull; Promotion: Promoted from {sess.promotionDetails.from_class} to {sess.promotionDetails.to_class}
                            </p>
                          )}
                        </div>

                        {/* Quick Term Print Actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenIndividualReport(sess.session, "term1", sess.historicalClass)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
                          >
                            1st Term Report
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenIndividualReport(sess.session, "term2", sess.historicalClass)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
                          >
                            2nd Term Report
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenIndividualReport(sess.session, "term3", sess.historicalClass)}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer shadow-xs"
                          >
                            3rd Term &amp; Annual Report
                          </button>
                        </div>
                      </div>

                      {/* Term Summaries Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {(["term1", "term2", "term3"] as const).map((t, idx) => {
                          const tData = sess.terms[t];
                          const label = idx === 0 ? "1st Term" : idx === 1 ? "2nd Term" : "3rd Term";
                          return (
                            <div
                              key={t}
                              className="bg-slate-50/70 border border-slate-200/60 rounded-xl p-3.5 space-y-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-xs text-slate-800">{label}</span>
                                <span className="text-[11px] font-semibold text-slate-500">
                                  {tData.evaluatedCount} Evaluated
                                </span>
                              </div>
                              <div className="text-xl font-black text-slate-900">
                                {tData.evaluatedCount > 0 ? `${tData.average}%` : "—"}
                              </div>
                              <div className="text-[11px] text-slate-500 font-medium">
                                Total Score: {tData.evaluatedCount > 0 ? tData.totalSum.toFixed(1) : "—"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-12 text-center text-slate-400">
              Search for any student above to view their academic results and history.
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Class Master Broadsheet */}
      {activeTab === "class-broadsheet" && (
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-wrap items-end gap-4 print:hidden">
            <div className="w-full sm:w-48">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Academic Session
              </label>
              <select
                value={selectedBroadsheetSession}
                onChange={(e) => setSelectedBroadsheetSession(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
              >
                {sessions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="w-full sm:w-56">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Class Roster
              </label>
              <select
                value={selectedBroadsheetClass}
                onChange={(e) => setSelectedBroadsheetClass(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="w-full sm:w-48">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Assessment Period
              </label>
              <select
                value={selectedBroadsheetTerm}
                onChange={(e) => setSelectedBroadsheetTerm(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
              >
                <option value="term1">1st Term Broadsheet</option>
                <option value="term2">2nd Term Broadsheet</option>
                <option value="term3">3rd Term Broadsheet</option>
                <option value="annual">Annual Full-Session Master</option>
              </select>
            </div>

            <div className="w-full sm:w-44">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Score Display View
              </label>
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as BroadsheetViewMode)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
              >
                <option value="score-grade">Score &amp; Grade (e.g. 78 A)</option>
                <option value="score-only">Score Only (e.g. 78)</option>
                <option value="breakdown">Breakdown (CA | Exam)</option>
              </select>
            </div>

            <button
              type="button"
              disabled={loadingBroadsheet}
              onClick={handleLoadBroadsheet}
              className="w-full sm:w-auto px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer disabled:opacity-50 transition-colors"
            >
              {loadingBroadsheet ? "Generating Broadsheet…" : "Generate Master Broadsheet"}
            </button>
          </div>

          {broadsheetError && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {broadsheetError}
            </div>
          )}

          {/* Broadsheet Output */}
          {broadsheetData && (
            <div className="space-y-4">
              {/* Header & Print Action */}
              <div className="flex items-center justify-between bg-white border border-slate-200 p-4 rounded-2xl shadow-xs print:hidden">
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">
                    {broadsheetData.className} — Master Result Sheet
                  </h3>
                  <p className="text-xs text-slate-500">
                    Session: <strong className="text-slate-800">{broadsheetData.session}</strong> &bull; Period:{" "}
                    <strong className="text-slate-800">
                      {broadsheetData.term === "annual" ? "Annual Cumulative" : broadsheetData.term.toUpperCase()}
                    </strong>{" "}
                    &bull; Class Size: <strong>{broadsheetData.studentsCount}</strong> &bull; Subjects:{" "}
                    <strong>{broadsheetData.subjectsCount}</strong> &bull; Class Average:{" "}
                    <strong className="text-indigo-600">{broadsheetData.classAverage}%</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition-colors print:hidden"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  <span>Print Official Broadsheet</span>
                </button>
              </div>

              {/* Printable Broadsheet Table */}
              <div className="bg-white border border-slate-300 rounded-2xl overflow-x-auto shadow-sm printable-broadsheet-container">
                {/* Official School Header block on printed document */}
                <div className="p-4 bg-slate-50 border-b border-slate-300 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-black tracking-tight text-slate-900 uppercase">
                      Gracemark Academy
                    </h2>
                    <p className="text-xs font-bold text-slate-700 tracking-wide mt-0.5">
                      Official Class Master Broadsheet &bull; {broadsheetData.className} &bull; Session {broadsheetData.session} &bull; {broadsheetData.term === "annual" ? "Annual Master" : broadsheetData.term.toUpperCase()}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-slate-600 font-medium">
                    <div>Class Size: <strong className="text-slate-900">{broadsheetData.studentsCount} Students</strong></div>
                    <div>Total Subjects: <strong className="text-slate-900">{broadsheetData.subjectsCount}</strong> &bull; Class Avg: <strong className="text-indigo-700">{broadsheetData.classAverage}%</strong></div>
                  </div>
                </div>

                <table className="w-full text-left border-collapse text-xs border-t border-slate-300">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 text-[10px] font-extrabold uppercase text-slate-700">
                      <th className="p-2 border-r border-slate-300 text-center w-8">#</th>
                      <th className="p-2 border-r border-slate-300 w-24">Adm No</th>
                      <th className="p-2 border-r border-slate-300 min-w-44">Student Name</th>
                      {broadsheetData.subjects.map((sub: any) => (
                        <th key={sub.id} className="p-2 border-r border-slate-300 text-center min-w-24">
                          <div className="font-extrabold text-[11px] leading-tight text-slate-800" title={sub.name}>
                            {sub.name}
                          </div>
                        </th>
                      ))}
                      <th className="p-2 border-r border-slate-300 text-center w-16 bg-slate-200">Total</th>
                      <th className="p-2 border-r border-slate-300 text-center w-16 bg-slate-200">Avg %</th>
                      <th className="p-2 text-center w-12 bg-indigo-100 text-indigo-900 font-black">Pos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {broadsheetData.rows.length === 0 ? (
                      <tr>
                        <td colSpan={broadsheetData.subjects.length + 6} className="p-8 text-center text-slate-400">
                          No score records found for this class and period.
                        </td>
                      </tr>
                    ) : (
                      broadsheetData.rows.map((r: any, idx: number) => (
                        <tr key={r.studentId} className="hover:bg-slate-50/80">
                          <td className="p-2 border-r border-slate-300 text-center font-mono text-slate-500">
                            {idx + 1}
                          </td>
                          <td className="p-2 border-r border-slate-300 font-mono text-slate-700 font-semibold">
                            {r.admissionNo}
                          </td>
                          <td className="p-2 border-r border-slate-300 font-bold text-slate-900">
                            {r.name}
                          </td>
                          {broadsheetData.subjects.map((sub: any) => {
                            const sc = r.subjectScores[sub.id];
                            const hasScore = sc?.total !== null && sc?.total !== undefined;
                            const isFail = hasScore && sc.total < 40;

                            return (
                              <td
                                key={sub.id}
                                className={`p-2 border-r border-slate-300 text-center font-mono ${
                                  isFail ? "text-rose-600 bg-rose-50/40" : "text-slate-800"
                                }`}
                              >
                                {hasScore ? (
                                  viewMode === "score-grade" ? (
                                    <div className="flex items-center justify-center gap-1">
                                      <span className="font-bold text-xs">{sc.total}</span>
                                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1 py-0.5 rounded">
                                        {sc.grade}
                                      </span>
                                    </div>
                                  ) : viewMode === "breakdown" ? (
                                    <div>
                                      <div className="text-[9px] text-slate-400 font-sans">
                                        CA:{(sc.cw ?? 0) + (sc.test ?? 0)} | Ex:{sc.exam ?? "—"}
                                      </div>
                                      <div className="font-bold text-xs text-slate-900">
                                        {sc.total} <span className="text-[9px] text-indigo-600 font-bold">({sc.grade})</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="font-bold text-xs">{sc.total}</span>
                                  )
                                ) : (
                                  <span className="text-slate-300 font-sans">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="p-2 border-r border-slate-300 text-center font-mono font-bold bg-slate-50">
                            {r.totalScore}
                          </td>
                          <td className="p-2 border-r border-slate-300 text-center font-mono font-bold bg-slate-50 text-indigo-700">
                            {r.average}%
                          </td>
                          <td className="p-2 text-center font-mono font-black text-indigo-900 bg-indigo-50/50">
                            {r.position}
                          </td>
                        </tr>
                      ))
                    )}

                    {/* Benchmark Summary Rows */}
                    {broadsheetData.rows.length > 0 && (
                      <>
                        <tr className="bg-slate-100 font-bold text-[10px] text-slate-700 border-t-2 border-slate-300">
                          <td colSpan={3} className="p-2 border-r border-slate-300 uppercase text-right">
                            Subject Average
                          </td>
                          {broadsheetData.subjects.map((sub: any) => (
                            <td key={sub.id} className="p-2 border-r border-slate-300 text-center font-mono font-bold text-indigo-900">
                              {broadsheetData.subjectStats[sub.id]?.avg ?? "—"}
                            </td>
                          ))}
                          <td colSpan={3} className="p-2 bg-slate-200"></td>
                        </tr>
                        <tr className="bg-slate-50 font-semibold text-[10px] text-emerald-700">
                          <td colSpan={3} className="p-2 border-r border-slate-300 uppercase text-right">
                            Highest Score
                          </td>
                          {broadsheetData.subjects.map((sub: any) => (
                            <td key={sub.id} className="p-2 border-r border-slate-300 text-center font-mono">
                              {broadsheetData.subjectStats[sub.id]?.highest ?? "—"}
                            </td>
                          ))}
                          <td colSpan={3} className="p-2"></td>
                        </tr>
                        <tr className="bg-slate-50 font-semibold text-[10px] text-rose-700">
                          <td colSpan={3} className="p-2 border-r border-slate-300 uppercase text-right">
                            Lowest Score
                          </td>
                          {broadsheetData.subjects.map((sub: any) => (
                            <td key={sub.id} className="p-2 border-r border-slate-300 text-center font-mono">
                              {broadsheetData.subjectStats[sub.id]?.lowest ?? "—"}
                            </td>
                          ))}
                          <td colSpan={3} className="p-2"></td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>

                {/* Sign-off Footers */}
                <div className="p-6 grid grid-cols-2 gap-12 pt-12 border-t border-slate-200 text-xs">
                  <div>
                    <div className="border-b border-slate-400 pb-1 w-64 mb-1"></div>
                    <span className="font-bold text-slate-800 uppercase tracking-wide">Class Teacher Signature &amp; Date</span>
                  </div>
                  <div className="text-right">
                    <div className="border-b border-slate-400 pb-1 w-64 ml-auto mb-1"></div>
                    <span className="font-bold text-slate-800 uppercase tracking-wide">Principal Signature &amp; Official Stamp</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Individual Printable Report Card Modal */}
      {printModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl p-6 border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4 print:hidden">
              <h3 className="font-bold text-base text-slate-900">
                Official Report Card — Historical Print
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  <span>Print Document</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>

            {loadingReportData ? (
              <div className="py-20 text-center text-slate-400">Loading historical report card…</div>
            ) : printReportData ? (
              <ResultDashboardApp student={studentCareer.student} initialReport={printReportData} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
