"use client";

import React, { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import { ClassRecord } from "@/types/database";

interface ClassFinancialSummary {
  classId: string;
  className: string;
  studentCount: number;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  collectionRate: number;
}

export default function AdminFinanceReportsPage() {
  const [summaries, setSummaries] = useState<ClassFinancialSummary[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [session, setSession] = useState("2025/2026");
  const [term, setTerm] = useState("term1");
  const [sessionsList, setSessionsList] = useState<string[]>([
    "2024/2025",
    "2025/2026",
    "2026/2027",
  ]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: classesData }, settings, { data: invoicesData, error: iErr }, { data: studentsData }] =
        await Promise.all([
          supabase.from("classes").select("id, name").order("name"),
          getAppSettings(),
          supabase.from("payment_invoices").select("*"),
          supabase.from("students").select("id, class_id"),
        ]);

      if (settings?.current_session) {
        setSession(settings.current_session);
        setSessionsList((prev) =>
          prev.includes(settings.current_session!) ? prev : [...prev, settings.current_session!]
        );
      }
      if (settings?.current_term) {
        setTerm(settings.current_term);
      }

      setClasses(classesData || []);
      if (iErr) throw iErr;

      // Group by class
      const clsList = classesData || [];
      const stdList = studentsData || [];
      const invList = (invoicesData || []).filter(
        (i: any) =>
          (!session || i.academic_session === session) && (!term || i.term === term)
      );

      const computed: ClassFinancialSummary[] = clsList.map((c) => {
        const classStudents = stdList.filter((s: any) => s.class_id === c.id);
        const classInvoices = invList.filter((i: any) => i.class_id === c.id);

        const totalBilled = classInvoices.reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0);
        const totalPaid = classInvoices.reduce((s: number, i: any) => s + Number(i.amount_paid || 0), 0);
        const outstanding = Math.max(0, totalBilled - totalPaid);
        const collectionRate = totalBilled > 0 ? +((totalPaid / totalBilled) * 100).toFixed(1) : 0;

        return {
          classId: c.id,
          className: c.name,
          studentCount: classStudents.length,
          totalBilled,
          totalPaid,
          outstanding,
          collectionRate,
        };
      });

      setSummaries(computed);
    } catch (err) {
      console.error("Failed to load financial reports:", err);
    } finally {
      setLoading(false);
    }
  }, [session, term]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const grandBilled = summaries.reduce((s, c) => s + c.totalBilled, 0);
  const grandPaid = summaries.reduce((s, c) => s + c.totalPaid, 0);
  const grandOutstanding = Math.max(0, grandBilled - grandPaid);
  const grandRate = grandBilled > 0 ? +((grandPaid / grandBilled) * 100).toFixed(1) : 0;

  function handleExportExcel() {
    const data = summaries.map((s) => ({
      Class: s.className,
      "Students Enrolled": s.studentCount,
      "Total Billed (NGN)": s.totalBilled,
      "Total Paid (NGN)": s.totalPaid,
      "Outstanding Balance (NGN)": s.outstanding,
      "Collection Rate (%)": `${s.collectionRate}%`,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Financial Summary");
    XLSX.writeFile(wb, `Gracemark_Finance_Report_${session.replace(/\//g, "-")}_${term}.xlsx`);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Financial Performance &amp; Reports</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Cohort collection analytics, revenue reconciliation, and fee settlement ratios.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportExcel}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold rounded-xl transition shadow-xs flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <span>Export to Excel</span>
        </button>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Billed</span>
          <div className="text-2xl font-black text-slate-900 mt-1">₦{grandBilled.toLocaleString()}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">Total Paid</span>
          <div className="text-2xl font-black text-emerald-600 mt-1">₦{grandPaid.toLocaleString()}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-500">Outstanding Balance</span>
          <div className="text-2xl font-black text-amber-600 mt-1">₦{grandOutstanding.toLocaleString()}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">Settlement Rate</span>
          <div className="text-2xl font-black text-indigo-600 mt-1">{grandRate}%</div>
        </div>
      </div>

      {/* Filter Row */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Session:</label>
          <select
            value={session}
            onChange={(e) => setSession(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-none"
          >
            {sessionsList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Term:</label>
          <select
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-none"
          >
            <option value="term1">1st Term</option>
            <option value="term2">2nd Term</option>
            <option value="term3">3rd Term</option>
          </select>
        </div>
      </div>

      {/* Cohort Performance Breakdown Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="portal-table-wrap overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Class Cohort</th>
                <th className="py-3 px-4">Enrolled Students</th>
                <th className="py-3 px-4">Expected (₦)</th>
                <th className="py-3 px-4">Collected (₦)</th>
                <th className="py-3 px-4">Outstanding (₦)</th>
                <th className="py-3 px-4">Collection Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    Computing class financial analytics…
                  </td>
                </tr>
              ) : summaries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No classes registered.
                  </td>
                </tr>
              ) : (
                summaries.map((s) => (
                  <tr key={s.classId} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-900">{s.className}</td>
                    <td className="py-3.5 px-4">{s.studentCount} students</td>
                    <td className="py-3.5 px-4">₦{s.totalBilled.toLocaleString()}</td>
                    <td className="py-3.5 px-4 font-bold text-emerald-600">₦{s.totalPaid.toLocaleString()}</td>
                    <td className="py-3.5 px-4 font-bold text-amber-600">₦{s.outstanding.toLocaleString()}</td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-slate-200 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-emerald-500 h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(100, s.collectionRate)}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-bold text-slate-600">{s.collectionRate}%</span>
                      </div>
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
