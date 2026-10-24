"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { getAuthHeaders } from "@/lib/supabase/client";
import { getAcademicSessions } from "@/lib/academicSessions";
import { getAppSettings } from "@/lib/appSettings";
import { PageLoader } from "@/components/shared/PageLoader";

interface Badge {
  id: string;
  student_id: string;
  badge_type: "position_1" | "position_2" | "position_3";
  level_name: string;
  class_name: string;
  position: number;
  ranked_count: number | null;
  term: string;
  session: string;
  awarded_at: string;
  students?: { name: string; admission_no: string };
}

const TERMS = [
  { value: "", label: "All terms" },
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

const MEDAL: Record<string, string> = { position_1: "🥇", position_2: "🥈", position_3: "🥉" };

export default function AdminBadgesPage() {
  const [sessions, setSessions] = useState<string[]>([]);
  const [session, setSession] = useState("");
  const [term, setTerm] = useState("");
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadSeqRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const [academicSessions, settings] = await Promise.all([getAcademicSessions(), getAppSettings()]);
        const sessionNames = academicSessions.map((s) => s.name);
        setSessions(sessionNames);
        setSession(settings?.current_session || sessionNames[0] || "");
      } catch (err: any) {
        setError(err.message || "Could not load setup.");
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

  const loadBadges = useCallback(async () => {
    if (!session) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError("");
    try {
      const url = new URL("/api/admin/badges", window.location.origin);
      url.searchParams.set("session", session);
      if (term) url.searchParams.set("term", term);
      const res = await fetch(url.toString(), { headers: await getAuthHeaders() });
      const json = await res.json();
      if (loadSeqRef.current !== seq) return;
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load badges.");
      setBadges(json.badges || []);
    } catch (err: any) {
      if (loadSeqRef.current === seq) {
        setError(err.message || "Could not load badges.");
        setBadges([]);
      }
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [term, session]);

  useEffect(() => {
    loadBadges();
  }, [loadBadges]);

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="portal-header bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Badges</h1>
          <p className="text-xs text-slate-500 mt-0.5">Awarded automatically on publish to the top 3 positions in each year level.</p>
        </header>

        <div className="p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-4">
          {loadingMeta ? (
            <PageLoader label="Loading…" />
          ) : (
            <>
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Session</label>
                  <select value={session} onChange={(e) => setSession(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold">
                    {sessions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Term</label>
                  <select value={term} onChange={(e) => setTerm(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold">
                    {TERMS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

              <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
                {loading ? (
                  <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
                ) : badges.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 text-sm">No badges awarded for this period yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          <th className="px-4 py-2.5">Badge</th>
                          <th className="px-2 py-2.5">Student</th>
                          <th className="px-2 py-2.5">Level / Class</th>
                          <th className="px-2 py-2.5">Term</th>
                          <th className="px-4 py-2.5 text-right">Awarded</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {badges.map((b) => (
                          <tr key={b.id} className="hover:bg-slate-50/60">
                            <td className="px-4 py-2.5 font-semibold">
                              {MEDAL[b.badge_type]} {b.position === 1 ? "1st" : b.position === 2 ? "2nd" : "3rd"}
                            </td>
                            <td className="px-2 py-2.5 text-slate-700">
                              {b.students?.name || "Student"} <span className="text-slate-400">({b.students?.admission_no})</span>
                            </td>
                            <td className="px-2 py-2.5 text-slate-600">
                              {b.level_name} · {b.class_name}
                            </td>
                            <td className="px-2 py-2.5 text-slate-600">
                              {b.term} · {b.session}
                            </td>
                            <td className="px-4 py-2.5 text-right text-slate-400">{new Date(b.awarded_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
