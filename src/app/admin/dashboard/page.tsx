"use client";

import { scheduleInitialLoad } from "@/lib/scheduleInitialLoad";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import { useIsRestrictedAdmin } from "@/components/shared/useIsRestrictedAdmin";
import { SkeletonValue } from "@/components/shared/Skeleton";
import AnnouncementsPreview from "@/components/announcements/AnnouncementsPreview";
import TermProgressWidget from "@/components/admin/TermProgressWidget";
import PendingActionsFeed from "@/components/shared/PendingActionsFeed";
import NewApplicationsCard from "@/components/admin/NewApplicationsCard";

export default function AdminDashboardPage() {
  const [adminName, setAdminName] = useState("");
  useEffect(() => {
    let active = true;
    async function loadName() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !active) return;
      const { data } = await supabase.from("users").select("display_name")
        .eq("auth_id", session.user.id).maybeSingle();
      if (active) setAdminName(data?.display_name?.trim() || "");
    }
    void loadName().catch(() => {});
    return () => { active = false; };
  }, []);
  const [stats, setStats] = useState({
    studentsCount: 0,
    classesCount: 0,
    teachersCount: 0,
    lockedCount: 0,
    totalExpected: 0,
    totalCollected: 0,
    totalOutstanding: 0,
  });

  const [statsLoading, setStatsLoading] = useState(true);
  const [period, setPeriod] = useState("");
  const restricted = useIsRestrictedAdmin();
  async function loadData() {
    try {
      // 1. Stats
      const [studentsRes, classesRes, teachersRes, lockedRes, invoicesRes] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("classes").select("id", { count: "exact", head: true }),
        supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "teacher"),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("portal_access_status", "locked"),
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
      setStatsLoading(false);

      const settings = await getAppSettings();
      setPeriod([settings?.current_session, settings?.current_term?.replace("term", "Term ")].filter(Boolean).join(" · "));
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => scheduleInitialLoad(loadData), []);

  return (
    <div className="space-y-8">
      {/* Top Welcome & KPI Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
          Welcome to the Admin Dashboard{adminName && `, ${adminName}`}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Monitor academy metrics, academic cycles, and continuous assessment workflow.
        </p>
      </div>

        {!restricted && <NewApplicationsCard />}

        <PendingActionsFeed role="admin" />

        <AnnouncementsPreview role="admin" />

        <TermProgressWidget />

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total Students
            </span>
            <div className="text-3xl font-extrabold text-slate-900 mt-1">
              <SkeletonValue loading={statsLoading} className="h-9 w-16">{stats.studentsCount}</SkeletonValue>
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
              <SkeletonValue loading={statsLoading} className="h-9 w-16">{stats.classesCount}</SkeletonValue>
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
              <SkeletonValue loading={statsLoading} className="h-9 w-16">{stats.teachersCount}</SkeletonValue>
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
              <SkeletonValue loading={statsLoading} className="h-9 w-16">{stats.lockedCount}</SkeletonValue>
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
      {/* <div className="text-white p-6 rounded-2xl shadow-md" style={{ backgroundColor: "#071120" }}>
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
              <SkeletonValue loading={statsLoading} dark className="h-7 w-36">₦{stats.totalExpected.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</SkeletonValue>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-emerald-400 font-semibold">Total Collected</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">
              <SkeletonValue loading={statsLoading} dark className="h-7 w-36">₦{stats.totalCollected.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</SkeletonValue>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-amber-400 font-semibold">Total Outstanding</div>
            <div className="text-2xl font-bold text-amber-400 mt-1">
              <SkeletonValue loading={statsLoading} dark className="h-7 w-36">₦{stats.totalOutstanding.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</SkeletonValue>
            </div>
          </div>
        </div>
      </div> */}

      <section><h3 className="font-bold">Academic period</h3><p>{period || "Academic period unavailable"}</p>
        {!restricted && <Link className="underline" href="/admin/term-setup">Academic Setup</Link>}
      </section>
    </div>
  );
}
