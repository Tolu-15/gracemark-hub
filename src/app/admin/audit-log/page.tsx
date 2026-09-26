"use client";

import React, { useCallback, useEffect, useState } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { getAuthHeaders } from "@/lib/supabase/client";
import { SkeletonRows } from "@/components/shared/Skeleton";

interface AuditRow {
  id: string;
  created_at: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  summary: string;
  metadata: Record<string, unknown>;
}

const CATEGORIES = [
  { value: "", label: "All activity" },
  { value: "scores", label: "Scores" },
  { value: "results", label: "Publish / recall" },
  { value: "promotion", label: "Promotions" },
  { value: "student", label: "Students & access" },
];

const TONE: Record<string, string> = {
  scores: "bg-sky-50 text-sky-700",
  results: "bg-emerald-50 text-emerald-700",
  promotion: "bg-indigo-50 text-indigo-700",
  student: "bg-amber-50 text-amber-800",
};

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (category) params.set("action", category);
      if (q.trim()) params.set("q", q.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/admin/audit?${params.toString()}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load the audit log.");
      setRows(json.logs);
      setTotal(json.total);
      setPageSize(json.pageSize);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, category, q, from, to]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 sticky top-0 z-20">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Audit Log</h1>
          <p className="text-sm text-slate-500 mt-1">
            A permanent record of who changed scores, published or recalled results, promoted students, and locked or deleted accounts.
          </p>
        </header>

        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Activity
              <select
                value={category}
                onChange={(e) => reset(setCategory)(e.target.value)}
                className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm normal-case tracking-normal font-semibold text-slate-800"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              From
              <input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm" />
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              To
              <input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm" />
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex-1 min-w-[200px]">
              Search
              <input
                type="search"
                value={q}
                onChange={(e) => reset(setQ)(e.target.value)}
                placeholder="Student, class or person…"
                className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm normal-case tracking-normal"
              />
            </label>
          </div>

          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">When</th>
                  <th className="px-4 py-3">Who</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <SkeletonRows rows={8} cols={4} />
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                      No activity recorded yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const cat = r.action.split(".")[0];
                    return (
                      <tr key={r.id} className="align-top">
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600 tabular-nums">
                          {new Date(r.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800 break-all">{r.actor_email || "—"}</div>
                          <div className="text-[11px] text-slate-400 capitalize">{r.actor_role}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold ${TONE[cat] || "bg-slate-100 text-slate-700"}`}>{r.action}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{r.summary}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>{total} entries</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white font-semibold disabled:opacity-40 cursor-pointer"
              >
                Previous
              </button>
              <span className="tabular-nums">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                disabled={page >= pages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white font-semibold disabled:opacity-40 cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
