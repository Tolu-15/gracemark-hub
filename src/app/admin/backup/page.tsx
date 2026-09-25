"use client";

import React, { useState, useEffect } from "react";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";

export default function AdminBackupPage() {
  const [downloading, setDownloading] = useState(false);
  const [stats, setStats] = useState({
    studentsCount: 0,
    resultsCount: 0,
    classesCount: 0,
    subjectsCount: 0,
    sessionsCount: 0,
    paymentsCount: 0,
  });
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const [
          { count: stdCount },
          { count: resCount },
          { count: clsCount },
          { count: subCount },
          { count: sessCount },
        ] = await Promise.all([
          supabase.from("students").select("*", { count: "exact", head: true }),
          supabase.from("results").select("*", { count: "exact", head: true }),
          supabase.from("classes").select("*", { count: "exact", head: true }),
          supabase.from("subjects").select("*", { count: "exact", head: true }),
          supabase.from("academic_sessions").select("*", { count: "exact", head: true }),
        ]);

        let payCount = 0;
        try {
          const { count: pC } = await supabase.from("fee_payments").select("*", { count: "exact", head: true });
          payCount = pC || 0;
        } catch {
          // ignore
        }

        setStats({
          studentsCount: stdCount || 0,
          resultsCount: resCount || 0,
          classesCount: clsCount || 0,
          subjectsCount: subCount || 0,
          sessionsCount: sessCount || 0,
          paymentsCount: payCount,
        });
      } catch (err) {
        console.error("Failed to load backup stats:", err);
      } finally {
        setLoadingStats(false);
      }
    }
    loadStats();
  }, []);

  async function handleDownloadBackup() {
    setDownloading(true);
    try {
      const res = await fetch("/api/admin/backup", { headers: await getAuthHeaders() });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to download backup");
      }

      // Convert stream to Blob and trigger browser download
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const todayStr = new Date().toISOString().slice(0, 10);
      a.download = `gracemark_full_school_backup_${todayStr}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(`Backup download failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  }

  const backupTables = [
    { name: "students", label: "Student Master Profiles", desc: "Admission numbers, bio data, portal status" },
    { name: "academic_sessions", label: "Academic Sessions", desc: "School calendar years and session terms" },
    { name: "classes & sections", label: "Classes & Class Arms", desc: "JSS 1-3 & SSS tracks (Science, Arts, Commercial)" },
    { name: "subjects", label: "Official Curriculum Subjects", desc: "WAEC, NECO & UBEC registered subjects" },
    { name: "student_subject_enrollments", label: "Student Subject Enrollments", desc: "Subject choices per student, dropped electives" },
    { name: "student_enrollments", label: "Historical Class Enrollments", desc: "Session-by-session class placement records" },
    { name: "results", label: "Official Academic Results", desc: "CW, HW, Test, Project, Exam, Totals & Grades" },
    { name: "published_snapshots", label: "Published Report Snapshots", desc: "Frozen milestone snapshots for students" },
    { name: "users", label: "Staff & User Profiles", desc: "Teachers, Admins, Staff IDs (Passcodes sanitized)" },
    { name: "class_teacher_assignments & subject_teacher_assignments", label: "Class & Subject Delegations", desc: "Teacher assignments per session and class arm" },
    { name: "fee_structures & fee_payments", label: "School Finance & Payments", desc: "Receipt logs, transactions, balances" },
    { name: "attendance & attendance_records", label: "School Attendance Registers", desc: "Daily morning/afternoon rolls, days present" },
    { name: "promotions", label: "Annual Class Promotions", desc: "Historical promotion logs and alumni graduation" },
    { name: "school_settings", label: "Institution Branding & Signatures", desc: "Principal stamp, resumption dates, policies" },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 sm:p-8 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
              Disaster Recovery Ready
            </span>
            <span className="text-xs text-slate-400 font-medium">Offline Compliance</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1.5">
            Full School Database Backup
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-xl">
            Export a complete, self-contained snapshot of all school records in JSON format. Store on secure offline cold storage or offsite drives for disaster recovery.
          </p>
        </div>

        <button
          type="button"
          disabled={downloading}
          onClick={handleDownloadBackup}
          className="px-6 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl shadow-md cursor-pointer flex items-center justify-center gap-2.5 disabled:opacity-50 transition-all shrink-0"
        >
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>{downloading ? "Preparing Complete Archive…" : "Download Full School Backup"}</span>
        </button>
      </div>

      {/* Database Inventory Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Students</span>
          <span className="text-xl font-black text-slate-900 mt-1 block">
            {loadingStats ? "…" : stats.studentsCount}
          </span>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Results Logged</span>
          <span className="text-xl font-black text-slate-900 mt-1 block">
            {loadingStats ? "…" : stats.resultsCount}
          </span>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Classes</span>
          <span className="text-xl font-black text-slate-900 mt-1 block">
            {loadingStats ? "…" : stats.classesCount}
          </span>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Curriculum</span>
          <span className="text-xl font-black text-slate-900 mt-1 block">
            {loadingStats ? "…" : stats.subjectsCount}
          </span>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Sessions</span>
          <span className="text-xl font-black text-slate-900 mt-1 block">
            {loadingStats ? "…" : stats.sessionsCount}
          </span>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Fee Receipts</span>
          <span className="text-xl font-black text-slate-900 mt-1 block">
            {loadingStats ? "…" : stats.paymentsCount}
          </span>
        </div>
      </div>

      {/* Included Datasets List */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-4">
        <h3 className="font-bold text-sm text-slate-900 uppercase tracking-wider">
          Included Disaster Recovery Datasets (14 Data Domains)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {backupTables.map((t) => (
            <div key={t.name} className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <strong className="text-slate-900 font-bold block">{t.label}</strong>
                <span className="text-slate-500 text-[11px] block mt-0.5">{t.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Disaster Recovery Guidelines */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-xs text-amber-900 space-y-2">
        <h4 className="font-bold text-sm flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Recommended Disaster Recovery Best Practices</span>
        </h4>
        <ul className="list-disc list-inside space-y-1 text-amber-800/90 pl-1 leading-relaxed">
          <li>Download backups at the conclusion of each academic term and immediately before executing class promotions.</li>
          <li>Store at least one encrypted copy on an external physical flash drive stored securely in the school administrative safe.</li>
          <li>All student passwords and auth credentials are sanitized from this archive for data privacy and security compliance.</li>
        </ul>
      </div>
    </div>
  );
}
