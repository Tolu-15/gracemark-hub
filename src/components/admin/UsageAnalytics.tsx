"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";

interface TrendDay {
  day: string;
  users: number;
  students: number;
  teachers: number;
  admins: number;
}
interface AccountRow {
  role: string;
  total: number;
  active_24h: number;
  active_7d: number;
  active_30d: number;
  never_signed_in: number;
}
interface EngagementRow {
  name: string;
  admission_no: string;
  class_name: string | null;
  last_sign_in_at: string | null;
  views: number;
  prints: number;
  last_view: string | null;
}
interface Analytics {
  days: number;
  trackingSince: string | null;
  loginTrend: TrendDay[];
  accounts: AccountRow[];
  topPages: { path: string; views: number; users: number }[];
  byRole: { role: string | null; page_views: number; active_users: number }[];
  resultViews: { students: number; total: number };
  resultPrints: { students: number; total: number };
  engagement: EngagementRow[];
  staffActions: { actor_role: string | null; action: string; n: number; last_at: string }[];
  staffActors: { email: string; actor_role: string | null; n: number; last_at: string }[];
  staffDaily: { day: string; n: number }[];
}

const BAR = "#2a78d6";
const GRID = "#e2e8f0";
const AXIS_TEXT = "#64748b";
const ROLE_ORDER = ["student", "teacher", "admin"];

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function niceStep(raw: number) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-2xl font-black mt-1 text-slate-900">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function DailyUsersChart({ data }: { data: TrendDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 210;
  const pad = { l: 30, r: 8, t: 10, b: 24 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const peak = Math.max(...data.map((d) => d.users), 1);
  const step = niceStep(peak / 4);
  const top = step * Math.ceil(peak / step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const band = innerW / data.length;
  const barW = Math.min(24, Math.max(band - 2, 2));
  const labelEvery = Math.ceil(data.length / 8);
  const y = (v: number) => pad.t + innerH - (v / top) * innerH;
  const hovered = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Users active per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + band * i + (band - barW) / 2;
          const h = (d.users / top) * innerH;
          const r = Math.min(4, h, barW / 2);
          const yTop = y(d.users);
          return (
            <g key={d.day}>
              {d.users > 0 && (
                <path
                  d={`M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + h} Z`}
                  fill={BAR}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
                  {fmtDay(d.day)}
                </text>
              )}
              <rect
                x={pad.l + band * i}
                y={pad.t}
                width={band}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${fmtDay(d.day)}: ${d.users} users`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md text-xs"
          style={{ left: `${((pad.l + band * (hover + 0.5)) / W) * 100}%`, top: `${(y(hovered.users) / H) * 100}%` }}
        >
          <div className="text-[11px] text-slate-500">{fmtDay(hovered.day)}</div>
          <div className="text-base font-black text-slate-900 leading-tight">{hovered.users} active</div>
          <div className="text-[11px] text-slate-600 mt-0.5 whitespace-nowrap">
            {hovered.students} students · {hovered.teachers} teachers · {hovered.admins} admins
          </div>
        </div>
      )}
    </div>
  );
}

export default function UsageAnalytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [onlyUnopened, setOnlyUnopened] = useState(false);

  const load = useCallback(async (range: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/dev-tools/analytics?days=${range}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load analytics.");
      setData(json);
    } catch (err: any) {
      setError(err.message || "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const series = useMemo<TrendDay[]>(() => {
    if (!data) return [];
    const byDay = new Map(data.loginTrend.map((d) => [d.day, d]));
    const out: TrendDay[] = [];
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - (days - 1));
    for (let i = 0; i < days; i++) {
      const key = ymd(cursor);
      out.push(byDay.get(key) || { day: key, users: 0, students: 0, teachers: 0, admins: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [data, days]);

  const accounts = useMemo(
    () => (data ? [...data.accounts].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)) : []),
    [data]
  );
  const students = accounts.find((a) => a.role === "student");
  const engagement = useMemo(
    () => (data ? data.engagement.filter((e) => !onlyUnopened || e.views === 0) : []),
    [data, onlyUnopened]
  );
  const trackingSince = data?.trackingSince ? fmtDateTime(data.trackingSince) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Usage Analytics</h2>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700"
          aria-label="Date range"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold mb-2">{error}</div>}
      {loading && !data && <div className="py-10 text-center text-slate-400 text-sm">Loading analytics…</div>}

      {data && (
        <div className={`space-y-4 ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Students active today" value={students ? `${students.active_24h} / ${students.total}` : "—"} sub={students ? `${students.never_signed_in} never signed in` : undefined} />
            <Tile label="Students active 7 days" value={students ? students.active_7d : "—"} sub={students ? `${students.active_30d} in 30 days` : undefined} />
            <Tile label="Results opened" value={data.resultViews.students} sub={`${data.resultViews.total} views by students`} />
            <Tile label="Results printed" value={data.resultPrints.students} sub={`${data.resultPrints.total} prints by students`} />
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
            <div className="text-sm font-bold text-slate-900">Users active per day</div>
            <div className="text-xs text-slate-500 mb-3">Distinct accounts that signed in or kept a session alive, by day (Lagos time).</div>
            <DailyUsersChart data={series} />
            <details className="mt-3">
              <summary className="text-xs font-bold text-indigo-600 cursor-pointer">View as table</summary>
              <div className="mt-2 max-h-64 overflow-auto border border-slate-100 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-1.5">Day</th>
                      <th className="text-right px-3 py-1.5">Total</th>
                      <th className="text-right px-3 py-1.5">Students</th>
                      <th className="text-right px-3 py-1.5">Teachers</th>
                      <th className="text-right px-3 py-1.5">Admins</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...series].reverse().map((d) => (
                      <tr key={d.day}>
                        <td className="px-3 py-1.5 text-slate-700">{fmtDay(d.day)}</td>
                        <td className="px-3 py-1.5 text-right font-bold text-slate-900">{d.users}</td>
                        <td className="px-3 py-1.5 text-right text-slate-600">{d.students}</td>
                        <td className="px-3 py-1.5 text-right text-slate-600">{d.teachers}</td>
                        <td className="px-3 py-1.5 text-right text-slate-600">{d.admins}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <p className="text-[11px] text-slate-400 mt-2">History before today is rebuilt from the auth system&apos;s session records, so older days can undercount.</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-900">Accounts by role</div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-1.5">Role</th>
                  <th className="text-right px-3 py-1.5">Total</th>
                  <th className="text-right px-3 py-1.5">24h</th>
                  <th className="text-right px-3 py-1.5">7 days</th>
                  <th className="text-right px-3 py-1.5">30 days</th>
                  <th className="text-right px-4 py-1.5">Never signed in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((a) => (
                  <tr key={a.role}>
                    <td className="px-4 py-1.5 font-semibold text-slate-800 capitalize">{a.role}s</td>
                    <td className="px-3 py-1.5 text-right text-slate-700">{a.total}</td>
                    <td className="px-3 py-1.5 text-right text-slate-700">{a.active_24h}</td>
                    <td className="px-3 py-1.5 text-right text-slate-700">{a.active_7d}</td>
                    <td className="px-3 py-1.5 text-right text-slate-700">{a.active_30d}</td>
                    <td className="px-4 py-1.5 text-right font-semibold text-amber-700">{a.never_signed_in}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-900">Student result engagement</div>
                <div className="text-[11px] text-slate-500">
                  {trackingSince
                    ? `Opens and prints are recorded from ${trackingSince}; earlier activity wasn't tracked.`
                    : "Tracking is live — opens and prints will appear here as students use their results."}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
                <input type="checkbox" checked={onlyUnopened} onChange={(e) => setOnlyUnopened(e.target.checked)} />
                Hasn&apos;t opened a result
              </label>
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-1.5">Student</th>
                    <th className="text-left px-3 py-1.5">Class</th>
                    <th className="text-left px-3 py-1.5">Last sign-in</th>
                    <th className="text-right px-3 py-1.5">Opened</th>
                    <th className="text-right px-3 py-1.5">Printed</th>
                    <th className="text-left px-4 py-1.5">Last opened</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {engagement.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                        No students to show.
                      </td>
                    </tr>
                  )}
                  {engagement.map((e) => (
                    <tr key={e.admission_no}>
                      <td className="px-4 py-1.5">
                        <div className="font-semibold text-slate-900">{e.name}</div>
                        <div className="text-slate-400">{e.admission_no}</div>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{e.class_name || "—"}</td>
                      <td className="px-3 py-1.5 text-slate-600">{fmtDateTime(e.last_sign_in_at)}</td>
                      <td className={`px-3 py-1.5 text-right font-bold ${e.views > 0 ? "text-emerald-700" : "text-slate-400"}`}>{e.views}</td>
                      <td className={`px-3 py-1.5 text-right font-bold ${e.prints > 0 ? "text-emerald-700" : "text-slate-400"}`}>{e.prints}</td>
                      <td className="px-4 py-1.5 text-slate-600">{fmtDateTime(e.last_view)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-900">Staff activity</div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-1.5">Account</th>
                    <th className="text-right px-3 py-1.5">Actions</th>
                    <th className="text-left px-4 py-1.5">Last action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.staffActors.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                        No staff actions in this range.
                      </td>
                    </tr>
                  )}
                  {data.staffActors.map((a) => (
                    <tr key={a.email}>
                      <td className="px-4 py-1.5">
                        <div className="font-semibold text-slate-900 break-all">{a.email}</div>
                        <div className="text-slate-400 capitalize">{a.actor_role || "—"}</div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-bold text-slate-900">{a.n}</td>
                      <td className="px-4 py-1.5 text-slate-600">{fmtDateTime(a.last_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-900">What staff are doing</div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-1.5">Action</th>
                    <th className="text-left px-3 py-1.5">By</th>
                    <th className="text-right px-4 py-1.5">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.staffActions.map((a) => (
                    <tr key={`${a.actor_role}-${a.action}`}>
                      <td className="px-4 py-1.5 font-mono text-slate-800">{a.action}</td>
                      <td className="px-3 py-1.5 text-slate-600 capitalize">{a.actor_role || "—"}</td>
                      <td className="px-4 py-1.5 text-right font-bold text-slate-900">{a.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="text-sm font-bold text-slate-900">Most visited pages</div>
              <div className="text-[11px] text-slate-500">
                {trackingSince ? `Page views are recorded from ${trackingSince}.` : "Page views will appear here as people use the app."}
              </div>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-1.5">Page</th>
                  <th className="text-right px-3 py-1.5">Views</th>
                  <th className="text-right px-4 py-1.5">People</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.topPages.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                      No page views recorded yet.
                    </td>
                  </tr>
                )}
                {data.topPages.map((p) => (
                  <tr key={p.path}>
                    <td className="px-4 py-1.5 font-mono text-slate-800">{p.path}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-slate-900">{p.views}</td>
                    <td className="px-4 py-1.5 text-right text-slate-600">{p.users}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
