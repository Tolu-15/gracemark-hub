"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { getAuthHeaders } from "@/lib/supabase/client";
import { getAcademicSessions } from "@/lib/academicSessions";
import { getAppSettings } from "@/lib/appSettings";
import { PageLoader } from "@/components/shared/PageLoader";

interface LevelGroup {
  name: string;
  classIds: string[];
  classNames: string[];
}

interface LeaderboardRow {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string;
  position: number;
  percentage: number;
  gpa: number | null;
  total: number;
  grade: string;
}

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

const MEDAL = ["🥇", "🥈", "🥉"];

interface BestOfClass {
  level: string;
  classNames: string[];
  best: LeaderboardRow | null;
  studentCount: number;
}

function gradeTone(g?: string) {
  return g === "A" ? "text-emerald-700 bg-emerald-50" : g === "B" ? "text-sky-700 bg-sky-50" : g === "D" ? "text-amber-700 bg-amber-50" : g === "F" ? "text-rose-700 bg-rose-50" : "text-slate-700 bg-slate-100";
}

export default function AdminLeaderboardPage() {
  const [levels, setLevels] = useState<LevelGroup[]>([]);
  const [level, setLevel] = useState("");
  const [sessions, setSessions] = useState<string[]>([]);
  const [session, setSession] = useState("");
  const [term, setTerm] = useState("term1");
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [isSenior, setIsSenior] = useState(false);
  const [loadingLevels, setLoadingLevels] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bests, setBests] = useState<BestOfClass[]>([]);
  const [loadingBests, setLoadingBests] = useState(false);
  const loadSeqRef = useRef(0);
  const bestsSeqRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const [levelsRes, academicSessions, settings] = await Promise.all([
          fetch("/api/admin/leaderboard", { headers: await getAuthHeaders() }).then((r) => r.json()),
          getAcademicSessions(),
          getAppSettings(),
        ]);
        if (levelsRes.ok) {
          setLevels(levelsRes.levels || []);
          if (levelsRes.levels?.length) setLevel(levelsRes.levels[0].name);
        }
        const sessionNames = academicSessions.map((s) => s.name);
        setSessions(sessionNames);
        setSession(settings?.current_session || sessionNames[0] || "");
        if (settings?.current_term) setTerm(settings.current_term);
      } catch (err: any) {
        setError(err.message || "Could not load leaderboard setup.");
      } finally {
        setLoadingLevels(false);
      }
    })();
  }, []);

  const loadLeaderboard = useCallback(async () => {
    if (!level || !session) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError("");
    try {
      const url = new URL("/api/admin/leaderboard", window.location.origin);
      url.searchParams.set("level", level);
      url.searchParams.set("term", term);
      url.searchParams.set("session", session);
      url.searchParams.set("milestone", "TR");
      const res = await fetch(url.toString(), { headers: await getAuthHeaders() });
      const json = await res.json();
      if (loadSeqRef.current !== seq) return;
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load the leaderboard.");
      setRows(json.rows || []);
      setIsSenior(Boolean(json.isSenior));
    } catch (err: any) {
      if (loadSeqRef.current === seq) {
        setError(err.message || "Could not load the leaderboard.");
        setRows([]);
      }
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [level, term, session]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  const loadBests = useCallback(async () => {
    if (!session) return;
    const seq = ++bestsSeqRef.current;
    setLoadingBests(true);
    try {
      const url = new URL("/api/admin/leaderboard", window.location.origin);
      url.searchParams.set("top", "1");
      url.searchParams.set("term", term);
      url.searchParams.set("session", session);
      url.searchParams.set("milestone", "TR");
      const res = await fetch(url.toString(), { headers: await getAuthHeaders() });
      const json = await res.json();
      if (bestsSeqRef.current !== seq) return;
      if (res.ok && json.ok) setBests(json.bests || []);
    } catch {
      /* the "best of class" strip is a convenience; ignore failures */
    } finally {
      if (bestsSeqRef.current === seq) setLoadingBests(false);
    }
  }, [term, session]);

  useEffect(() => {
    loadBests();
  }, [loadBests]);

  const showsArms = new Set(rows.map((r) => r.className)).size > 1;

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="portal-header bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Leaderboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Terminal-result ranking per year level. For SSS, every arm (Science/Arts/Commercial) is ranked together as one SSS1/SSS2/SSS3 cohort.
          </p>
        </header>

        <div className="p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-4">
          {loadingLevels ? (
            <PageLoader label="Loading…" />
          ) : (
            <>
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Level</label>
                  <select value={level} onChange={(e) => setLevel(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold">
                    {levels.map((l) => (
                      <option key={l.name} value={l.name}>
                        {l.name} {l.classIds.length > 1 ? `(${l.classNames.join(", ")})` : ""}
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
              </div>

              {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Best of Each Class</h2>
                {loadingBests ? (
                  <div className="py-8 text-center text-slate-400 text-xs">Loading…</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {bests.map((b) => (
                      <button
                        key={b.level}
                        type="button"
                        onClick={() => setLevel(b.level)}
                        className={`text-left bg-white border rounded-2xl p-3 shadow-xs hover:border-slate-300 transition-colors cursor-pointer ${
                          level === b.level ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200/80"
                        }`}
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{b.level}</div>
                        {b.best ? (
                          <>
                            <div className="text-sm font-bold text-slate-900 truncate mt-1">🏆 {b.best.name}</div>
                            <div className="text-[11px] text-slate-500">
                              {b.classNames.length > 1 ? b.best.className : b.best.admissionNo} ·{" "}
                              {b.best.gpa !== null ? `GPA ${b.best.gpa.toFixed(2)}` : `${b.best.percentage}%`}
                            </div>
                          </>
                        ) : (
                          <div className="text-xs text-slate-400 mt-1">No results yet</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
                {loading ? (
                  <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
                ) : rows.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 text-sm">No terminal results for this level yet.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <div key={r.studentId} className={`flex items-center gap-3 px-4 py-3 ${r.position <= 3 ? "bg-amber-50/40" : ""}`}>
                        <div className="w-9 text-center text-sm font-black text-slate-700 shrink-0">
                          {r.position <= 3 ? MEDAL[r.position - 1] : r.position}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900 truncate">{r.name}</div>
                          <div className="text-[11px] text-slate-400">
                            {r.admissionNo}
                            {showsArms ? ` · ${r.className}` : ""}
                          </div>
                        </div>
                        <div className={`px-2 py-1 rounded-lg text-xs font-bold ${gradeTone(r.grade)}`}>{r.grade}</div>
                        <div className="text-right w-20 shrink-0">
                          <div className="text-sm font-black text-slate-900">{isSenior ? r.gpa?.toFixed(2) : `${r.percentage}%`}</div>
                          <div className="text-[10px] text-slate-400">{isSenior ? "GPA" : "average"}</div>
                        </div>
                      </div>
                    ))}
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
