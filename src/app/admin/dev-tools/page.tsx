"use client";

import React, { useEffect, useState } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { getAuthHeaders } from "@/lib/supabase/client";
import { PageLoader } from "@/components/shared/PageLoader";

interface ScanIssue {
  type: string;
  severity: "high" | "medium";
  summary: string;
  details: Record<string, any>;
}

interface LookupResult {
  student: { id: string; name: string; admission_no: string; gender: string | null; class: string | null; portal_access_status: string | null };
  login: { id: string; email: string; display_name: string; status: string; must_change_password: boolean } | null;
  auth: { email: string; email_confirmed_at: string | null; last_sign_in_at: string | null; created_at: string } | null;
}

const ISSUE_LABEL: Record<string, string> = {
  duplicate_admission_no: "Duplicate admission number",
  orphaned_account: "Orphaned login account",
  email_drift: "Login email doesn't match admission number",
  duplicate_email: "Duplicate login email",
};

function StatCard({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" }) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-2xl font-black mt-1 ${tone === "warn" ? "text-amber-600" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}

export default function AdminDevToolsPage() {
  const [access, setAccess] = useState<"checking" | "ok" | "denied">("checking");
  const [health, setHealth] = useState<any | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(true);

  const [issues, setIssues] = useState<ScanIssue[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");

  const [fixing, setFixing] = useState(false);
  const [fixMessage, setFixMessage] = useState("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  async function loadHealth() {
    setLoadingHealth(true);
    try {
      const res = await fetch("/api/admin/dev-tools/health", { headers: await getAuthHeaders() });
      const json = await res.json();
      if (res.status === 403) {
        setAccess("denied");
        return;
      }
      if (res.ok && json.ok) {
        setHealth(json);
        setAccess("ok");
      }
    } finally {
      setLoadingHealth(false);
    }
  }

  useEffect(() => {
    loadHealth();
  }, []);

  async function runScan() {
    setScanning(true);
    setScanError("");
    try {
      const res = await fetch("/api/admin/dev-tools/scan", { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Scan failed.");
      setIssues(json.issues || []);
    } catch (err: any) {
      setScanError(err.message || "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  async function fixOrphans() {
    setFixing(true);
    setFixMessage("");
    try {
      const res = await fetch("/api/admin/dev-tools/fix-orphans", { method: "POST", headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Cleanup failed.");
      setFixMessage(`Removed ${json.removedCount} orphaned login account(s).`);
      await runScan();
    } catch (err: any) {
      setFixMessage(err.message || "Cleanup failed.");
    } finally {
      setFixing(false);
    }
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError("");
    try {
      const res = await fetch(`/api/admin/dev-tools/lookup?q=${encodeURIComponent(query.trim())}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Lookup failed.");
      setResults(json.results || []);
    } catch (err: any) {
      setSearchError(err.message || "Lookup failed.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="portal-header bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Dev Tools</h1>
          <p className="text-xs text-slate-500 mt-0.5">Account integrity, student lookup, and system health — developer-only.</p>
        </header>

        <div className="p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-6">
          {access === "checking" || loadingHealth ? (
            <PageLoader label="Loading…" />
          ) : access === "denied" ? (
            <div className="bg-white border border-rose-200 rounded-2xl p-6 text-center text-rose-700 text-sm font-semibold">
              Developer tools access required.
            </div>
          ) : (
            <>
              {/* System health */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">System Health</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <StatCard label="Students" value={health.students.total} />
                  <StatCard label="Students w/o login" value={health.students.withoutLogin} tone={health.students.withoutLogin > 0 ? "warn" : undefined} />
                  <StatCard label="Teachers / Admins" value={`${health.staff.teachers} / ${health.staff.admins}`} />
                  <StatCard label="Pending review" value={health.approvals.pendingReview} />
                  <StatCard label="Returned for correction" value={health.approvals.returnedForCorrection} />
                  <StatCard label="Push-enabled accounts" value={`${health.push.distinctUsersSubscribed} / ${health.push.totalStaffAndStudents}`} />
                </div>
              </div>

              {/* Integrity scanner */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Account Integrity Scanner</h2>
                  <div className="flex gap-2">
                    {issues !== null && issues.some((i) => i.type === "orphaned_account") && (
                      <button
                        type="button"
                        onClick={fixOrphans}
                        disabled={fixing}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-50"
                      >
                        {fixing ? "Cleaning…" : "Clean Up Orphaned Logins"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={runScan}
                      disabled={scanning}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-50"
                    >
                      {scanning ? "Scanning…" : "Run Scan"}
                    </button>
                  </div>
                </div>
                {scanError && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold mb-2">{scanError}</div>}
                {fixMessage && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold mb-2">{fixMessage}</div>}
                <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
                  {issues === null ? (
                    <div className="py-10 text-center text-slate-400 text-sm">Click &ldquo;Run Scan&rdquo; to check for duplicate admission numbers, orphaned logins, and email drift.</div>
                  ) : issues.length === 0 ? (
                    <div className="py-10 text-center text-emerald-600 text-sm font-semibold">No issues found.</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {issues.map((issue, i) => (
                        <div key={i} className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${issue.severity === "high" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                              {ISSUE_LABEL[issue.type] || issue.type}
                            </span>
                          </div>
                          <p className="text-sm text-slate-800 mt-1">{issue.summary}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Student lookup */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Student Lookup</h2>
                <form onSubmit={runSearch} className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Name or admission number…"
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm"
                  />
                  <button type="submit" disabled={searching} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer disabled:opacity-50">
                    {searching ? "Searching…" : "Search"}
                  </button>
                </form>
                {searchError && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold mb-2">{searchError}</div>}
                <div className="space-y-3">
                  {results.map((r) => (
                    <div key={r.student.id} className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Student</div>
                        <div className="font-semibold text-slate-900">{r.student.name}</div>
                        <div className="text-slate-500">{r.student.admission_no} · {r.student.class || "no class"}</div>
                        <div className="text-slate-500">{r.student.portal_access_status}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Login</div>
                        {r.login ? (
                          <>
                            <div className="font-semibold text-slate-900 break-all">{r.login.email}</div>
                            <div className="text-slate-500">{r.login.status} · {r.login.must_change_password ? "must change password" : "password set"}</div>
                          </>
                        ) : (
                          <div className="text-rose-600 font-semibold">No login account</div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Auth</div>
                        {r.auth ? (
                          <>
                            <div className="text-slate-500">Confirmed: {r.auth.email_confirmed_at ? "yes" : "no"}</div>
                            <div className="text-slate-500">Last sign-in: {r.auth.last_sign_in_at ? new Date(r.auth.last_sign_in_at).toLocaleString() : "never"}</div>
                          </>
                        ) : (
                          <div className="text-rose-600 font-semibold">No auth record</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
