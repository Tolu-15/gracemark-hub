"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import { PageLoader } from "@/components/shared/PageLoader";

type Status = "never_signed_in" | "password_not_changed" | "ok";
interface Row {
  id: string;
  name: string;
  admissionNo: string;
  className: string;
  hasLogin: boolean;
  lastSignInAt: string | null;
  status: Status;
}
interface Slip {
  name: string;
  admissionNo: string;
  className: string;
  password: string;
}

const STATUS_LABEL: Record<Status, string> = {
  never_signed_in: "Never signed in",
  password_not_changed: "Signed in, password not changed",
  ok: "All set",
};
const STATUS_STYLE: Record<Status, string> = {
  never_signed_in: "bg-rose-50 text-rose-700 border-rose-200",
  password_not_changed: "bg-amber-50 text-amber-800 border-amber-200",
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(await getAuthHeaders()), ...(init?.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

export default function StudentLoginsPage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [classId, setClassId] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Record<Status, number>>({ never_signed_in: 0, password_not_changed: 0, ok: 0 });
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [slips, setSlips] = useState<Slip[]>([]);
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("classes")
      .select("id, name")
      .not("name", "like", "ZZ Test%")
      .order("display_order")
      .then(({ data }) => setClasses(data || []));
  }, []);

  const load = useCallback(async () => {
    setRows(null);
    const { res, json } = await api(`/api/admin/student-logins${classId ? `?class_id=${classId}` : ""}`);
    if (!res.ok || !json.ok) return setError(json.error || "Could not load students.");
    setError(null);
    setRows(json.students);
    setCounts(json.counts);
    setSelected(new Set());
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => (rows || []).filter((r) => filter === "all" || r.status !== "ok"), [rows, filter]);
  const selectable = shown.filter((r) => r.status === "never_signed_in" && r.hasLogin);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function makeSlips() {
    if (!selected.size) return;
    if (
      !window.confirm(
        `Prepare slips for ${selected.size} student${selected.size === 1 ? "" : "s"}? Their password is set to the school default again so the slip is correct. Only students who have never signed in are changed; anyone who has signed in is left alone.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const { res, json } = await api("/api/admin/student-logins", { method: "POST", body: JSON.stringify({ student_ids: Array.from(selected) }) });
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not prepare the slips.");
      setSlips(json.slips);
      setRefused(json.refused || []);
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-5 max-w-5xl mx-auto print:hidden">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Student Logins</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            See who has not signed in or has not chosen their own password yet, and print login slips for the class teachers to hand out.
          </p>
        </div>

        {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

        <div className="grid grid-cols-3 gap-3">
          {(["never_signed_in", "password_not_changed", "ok"] as Status[]).map((s) => (
            <div key={s} className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{STATUS_LABEL[s]}</div>
              <div className="text-2xl font-black text-slate-900 mt-1">{rows ? counts[s] : "…"}</div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-end gap-3">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Class
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="mt-1 block w-44 px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800">
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Show
            <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="mt-1 block px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800">
              <option value="attention">Needs attention</option>
              <option value="all">Everyone</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setSelected(selectable.length && selectable.every((r) => selected.has(r.id)) ? new Set() : new Set(selectable.map((r) => r.id)))}
            disabled={!selectable.length}
            className="px-3 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 cursor-pointer disabled:opacity-40"
          >
            {selectable.length && selectable.every((r) => selected.has(r.id)) ? "Unselect all" : "Select all never-signed-in"}
          </button>
          <button
            type="button"
            onClick={makeSlips}
            disabled={busy || !selected.size}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40"
          >
            {busy ? "Preparing…" : `Prepare ${selected.size || ""} login slip${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>

        {refused.length > 0 && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-0.5">
            {refused.map((r, i) => (
              <div key={i}>
                <strong>{r.name}</strong>: {r.reason}
              </div>
            ))}
          </div>
        )}

        {slips.length > 0 && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>{slips.length}</strong> slip{slips.length === 1 ? "" : "s"} ready. These students must choose a new password the first time they sign in.
            </span>
            <button type="button" onClick={() => window.print()} className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg text-xs cursor-pointer">
              Print slips
            </button>
          </div>
        )}

        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
          {rows === null ? (
            <PageLoader label="Checking logins…" />
          ) : shown.length === 0 ? (
            <div className="py-10 text-center text-sm text-emerald-700 font-semibold">Everyone here has signed in and chosen their own password.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-left">
                    <th className="px-4 py-2.5 w-8"></th>
                    <th className="px-2 py-2.5">Student</th>
                    <th className="px-2 py-2.5">Class</th>
                    <th className="px-2 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Last sign-in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2.5">
                        {r.status === "never_signed_in" && r.hasLogin && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="font-semibold text-slate-900">{r.name}</div>
                        <div className="text-[11px] text-slate-500">{r.admissionNo}</div>
                      </td>
                      <td className="px-2 py-2.5">{r.className}</td>
                      <td className="px-2 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                        {!r.hasLogin && <span className="ml-2 text-[11px] text-rose-600">no login account</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{r.lastSignInAt ? new Date(r.lastSignInAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-400">
          Slips are only made for students who have never signed in, because their password is known to be the default. Students who have signed in but not changed their password can be reset one at a time from Manage Students.
        </p>
      </div>

      {/* Printable slips: cut along the dashed lines */}
      {slips.length > 0 && (
        <div className="hidden print:grid grid-cols-2 gap-3 p-4">
          {slips.map((s) => (
            <div key={s.admissionNo} className="border-2 border-dashed border-slate-500 p-4 break-inside-avoid text-sm leading-relaxed">
              <div className="font-bold text-base">Gracemark Academy · Student Portal</div>
              <div className="mt-1">
                <strong>{s.name}</strong> · {s.className}
              </div>
              <div className="mt-2">
                Portal: <strong>www.gracemarkportal.com.ng</strong>
              </div>
              <div>
                Admission number: <strong className="font-mono">{s.admissionNo}</strong>
              </div>
              <div>
                Password: <strong className="font-mono">{s.password}</strong>
              </div>
              <div className="mt-2 text-xs">You will be asked to choose a new password the first time you sign in. Keep it private.</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
