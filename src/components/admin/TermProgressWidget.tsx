"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/supabase/client";
import { SkeletonValue } from "@/components/shared/Skeleton";

const TERM_LABELS: Record<string, string> = { term1: "1st Term", term2: "2nd Term", term3: "3rd Term" };

interface Summary {
  term: string;
  session: string;
  counts: { draft: number; submitted: number; approved: number; returned: number };
  total: number;
}

/** Dashboard card: how the current term's scores are moving through draft → submitted → approved. */
export default function TermProgressWidget() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/results/status-summary", { headers: await getAuthHeaders() });
        const json = await res.json();
        if (!cancelled && json.ok) setSummary(json);
      } catch {
        /* the widget just stays empty on failure */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = summary?.counts || { draft: 0, submitted: 0, approved: 0, returned: 0 };
  const termLabel = summary ? TERM_LABELS[summary.term] || summary.term : "";

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="text-base font-bold text-slate-900">Term Submission Progress</h3>
        <Link href="/admin/approvals" className="text-xs font-semibold text-blue-600 hover:text-blue-800 whitespace-nowrap">
          Review submissions →
        </Link>
      </div>
      <p className="text-xs text-slate-500 mb-5">
        {loading ? (
          <SkeletonValue loading className="h-3 w-40">.</SkeletonValue>
        ) : (
          <>How scores are moving through the pipeline{termLabel ? ` — ${termLabel}${summary?.session ? `, ${summary.session}` : ""}` : ""}.</>
        )}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Draft</div>
          <div className="text-2xl font-extrabold text-slate-700 mt-0.5">
            <SkeletonValue loading={loading} className="h-7 w-10">{counts.draft}</SkeletonValue>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-sky-50 border border-sky-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-sky-600">Submitted</div>
          <div className="text-2xl font-extrabold text-sky-700 mt-0.5">
            <SkeletonValue loading={loading} className="h-7 w-10">{counts.submitted}</SkeletonValue>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Approved</div>
          <div className="text-2xl font-extrabold text-emerald-700 mt-0.5">
            <SkeletonValue loading={loading} className="h-7 w-10">{counts.approved}</SkeletonValue>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600">Returned</div>
          <div className="text-2xl font-extrabold text-rose-700 mt-0.5">
            <SkeletonValue loading={loading} className="h-7 w-10">{counts.returned}</SkeletonValue>
          </div>
        </div>
      </div>

      {!loading && counts.submitted > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-4 font-semibold">
          {counts.submitted} score{counts.submitted === 1 ? "" : "s"} waiting for your review.
        </p>
      )}
    </div>
  );
}
