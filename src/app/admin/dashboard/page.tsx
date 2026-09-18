"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { getAppSettings, setAppSettings } from "@/lib/appSettings";

interface TermStatus {
  term: string;
  label: string;
  is_current: boolean;
  allow_edit: boolean;
  status: string;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState({
    studentsCount: 0,
    classesCount: 0,
    teachersCount: 0,
    lockedCount: 0,
    totalExpected: 0,
    totalCollected: 0,
    totalOutstanding: 0,
  });

  const [term, setTerm] = useState("1st Term");
  const [session, setSession] = useState("2025/2026");
  const [sessionsList, setSessionsList] = useState<string[]>(["2024/2025", "2025/2026", "2026/2027"]);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [newSessionInput, setNewSessionInput] = useState("");
  const [termsList, setTermsList] = useState<TermStatus[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [updatingTerm, setUpdatingTerm] = useState<string | null>(null);

  function termDbToUi(t?: string) {
    if (t === "term1") return "1st Term";
    if (t === "term2") return "2nd Term";
    if (t === "term3") return "3rd Term";
    return "1st Term";
  }

  function termUiToDb(t: string) {
    if (t === "1st Term") return "term1";
    if (t === "2nd Term") return "term2";
    if (t === "3rd Term") return "term3";
    return "term1";
  }

  async function loadData() {
    try {
      // 1. Stats
      const [studentsRes, classesRes, teachersRes, lockedRes, invoicesRes] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("classes").select("id", { count: "exact", head: true }),
        supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "teacher"),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("portal_access_status", "LOCKED"),
        supabase.from("payment_invoices").select("total_amount, amount_paid"),
      ]);

      const invs = invoicesRes.data || [];
      const exp = invs.reduce((sum: number, i: any) => sum + Number(i.total_amount || 0), 0);
      const coll = invs.reduce((sum: number, i: any) => sum + Number(i.amount_paid || 0), 0);
      const out = Math.max(0, exp - coll);

      setStats({
        studentsCount: studentsRes.count ?? 0,
        classesCount: classesRes.count ?? 0,
        teachersCount: teachersRes.count ?? 0,
        lockedCount: lockedRes.count ?? 0,
        totalExpected: exp,
        totalCollected: coll,
        totalOutstanding: out,
      });

      // 2. Settings
      const appSettings = await getAppSettings();
      if (appSettings) {
        setTerm(termDbToUi(appSettings.current_term));
        const sess = String(appSettings.current_session || "").trim();
        if (sess) {
          setSession(sess);
          setSessionsList((prev) =>
            prev.includes(sess) ? prev : [...prev, sess]
          );
        }
      }

      // 3. Term permissions
      await loadTermPermissions();
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    }
  }

  async function loadTermPermissions() {
    try {
      const res = await fetch("/api/terms");
      if (res.ok) {
        const data = await res.json();
        setTermsList(data.terms || []);
      }
    } catch (err) {
      console.error("Failed to load term permissions:", err);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSaveSettings() {
    setSavingSettings(true);
    try {
      let targetSession = session;
      if (isCreatingSession && newSessionInput.trim()) {
        targetSession = newSessionInput.trim();
        setSessionsList((prev) => (prev.includes(targetSession) ? prev : [...prev, targetSession]));
        setSession(targetSession);
        setIsCreatingSession(false);
        setNewSessionInput("");
      }

      await setAppSettings({
        current_term: termUiToDb(term),
        current_session: targetSession,
      });

      alert(`Global academic settings updated! Active Session is now: ${targetSession}`);
      await loadTermPermissions();
    } catch (error: any) {
      alert("Failed to save global settings: " + error.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleToggleTerm(t: TermStatus) {
    setUpdatingTerm(t.term);
    try {
      const res = await fetch("/api/admin/terms/toggle-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session,
          term: t.term,
          allow_edit: !t.allow_edit,
        }),
      });
      if (!res.ok) throw new Error("Failed to update term edit permission");
      await loadTermPermissions();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setUpdatingTerm(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Top Welcome & KPI Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Executive Overview</h2>
        <p className="text-sm text-slate-500 mt-1">
          Monitor academy metrics, academic cycles, and continuous assessment workflow.
        </p>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total Students
            </span>
            <div className="text-3xl font-extrabold text-slate-900 mt-1">
              {stats.studentsCount}
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Classes
            </span>
            <div className="text-3xl font-extrabold text-slate-900 mt-1">
              {stats.classesCount}
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total Teachers
            </span>
            <div className="text-3xl font-extrabold text-slate-900 mt-1">
              {stats.teachersCount}
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Locked Portals
            </span>
            <div className="text-3xl font-extrabold text-rose-600 mt-1">
              {stats.lockedCount}
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Financial Health Summary Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-950 text-white p-6 rounded-2xl shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-lg font-bold">Tuition Revenue &amp; Collections</h3>
            <p className="text-xs text-slate-400 mt-0.5">Aggregated school fees across all classes</p>
          </div>
          <Link
            href="/admin/finance/reports"
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white rounded-lg transition"
          >
            View Detailed Reports →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2 border-t border-slate-800">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Total Invoiced</div>
            <div className="text-2xl font-bold text-slate-100 mt-1">
              ₦{stats.totalExpected.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-emerald-400 font-semibold">Total Collected</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">
              ₦{stats.totalCollected.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-amber-400 font-semibold">Total Outstanding</div>
            <div className="text-2xl font-bold text-amber-400 mt-1">
              ₦{stats.totalOutstanding.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      {/* Academic Term Controls & Term Edit Permissions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Term & Session Switcher */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
          <h3 className="text-base font-bold text-slate-900 mb-1">Academic Session &amp; Term Settings</h3>
          <p className="text-xs text-slate-500 mb-6">
            Global controls dictate the active cycle across all teacher gradebooks and student dashboards.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                Active Academic Term
              </label>
              <select
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="1st Term">1st Term</option>
                <option value="2nd Term">2nd Term</option>
                <option value="3rd Term">3rd Term</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Active Session
                </label>
                <button
                  type="button"
                  onClick={() => setIsCreatingSession(!isCreatingSession)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  {isCreatingSession ? "Cancel" : "+ Create New"}
                </button>
              </div>

              {!isCreatingSession ? (
                <select
                  value={session}
                  onChange={(e) => setSession(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  {sessionsList.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={newSessionInput}
                  onChange={(e) => setNewSessionInput(e.target.value)}
                  placeholder="e.g. 2026/2027"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              )}
            </div>

            <button
              type="button"
              disabled={savingSettings}
              onClick={handleSaveSettings}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition shadow-sm mt-2 disabled:opacity-50"
            >
              {savingSettings ? "Saving Settings…" : "Save Academic Settings"}
            </button>
          </div>
        </div>

        {/* Term Edit Overrides Matrix */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
          <h3 className="text-base font-bold text-slate-900 mb-1">Teacher Score Entry Permissions</h3>
          <p className="text-xs text-slate-500 mb-6">
            Non-current terms are locked by default. Permit temporary overrides for revisions.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {termsList.map((t) => {
              if (t.is_current) {
                return (
                  <div
                    key={t.term}
                    className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl flex flex-col justify-between gap-3 shadow-xs"
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase text-blue-600 block">
                        Current Active
                      </span>
                      <span className="text-base font-bold text-blue-950">{t.label}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                      Always Open
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={t.term}
                  className={`p-4 rounded-xl flex flex-col justify-between gap-3 border shadow-xs transition-colors ${
                    t.allow_edit ? "bg-emerald-50/70 border-emerald-200" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div>
                    <span
                      className={`text-[10px] font-bold uppercase block ${
                        t.allow_edit ? "text-emerald-600" : "text-slate-400"
                      }`}
                    >
                      {t.allow_edit ? "Override Open" : "Locked (Default)"}
                    </span>
                    <span className="text-base font-bold text-slate-800">{t.label}</span>
                  </div>
                  <button
                    type="button"
                    disabled={updatingTerm === t.term}
                    onClick={() => handleToggleTerm(t)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                      t.allow_edit
                        ? "bg-rose-100 hover:bg-rose-200 text-rose-800 border-rose-300"
                        : "bg-indigo-600 hover:bg-indigo-700 text-white border-transparent"
                    }`}
                  >
                    {updatingTerm === t.term ? "Updating…" : t.allow_edit ? "🔒 Lock Term" : "🔓 Permit Edit"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
