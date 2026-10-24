"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";
import { PageLoader } from "@/components/shared/PageLoader";

interface Sheet {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  expected: number;
  done: number;
  draft: number;
  returned: number;
  state: "not_started" | "in_progress" | "returned";
}
interface Teacher {
  userId: string;
  name: string;
  email: string;
  sheets: Sheet[];
  lastRemindedAt: string | null;
}
interface Report {
  term: string;
  session: string;
  teachers: Teacher[];
  totalSheets: number;
  completeSheets: number;
  emailConfigured: boolean;
}

const TERM_LABEL: Record<string, string> = { term1: "1st Term", term2: "2nd Term", term3: "3rd Term" };
const STATE_STYLE: Record<Sheet["state"], string> = {
  not_started: "bg-rose-50 text-rose-700 border-rose-200",
  in_progress: "bg-amber-50 text-amber-800 border-amber-200",
  returned: "bg-sky-50 text-sky-800 border-sky-200",
};
const STATE_LABEL: Record<Sheet["state"], string> = { not_started: "Not started", in_progress: "In progress", returned: "Returned" };

const ago = (iso: string) => {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
};

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(await getAuthHeaders()), ...(init?.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

export default function AdminLateSheetsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; status: string; detail: string }[]>([]);

  const load = useCallback(async () => {
    const { res, json } = await api("/api/admin/late-sheets");
    if (!res.ok || !json.ok) return setError(json.error || "Could not load score sheets.");
    setError(null);
    setReport(json);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function remind() {
    if (!selected.size) return;
    if (!window.confirm(`Send a reminder to ${selected.size} teacher${selected.size === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    setResults([]);
    try {
      const { res, json } = await api("/api/admin/late-sheets", { method: "POST", body: JSON.stringify({ teacher_ids: Array.from(selected), note }) });
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not send reminders.");
      setResults(json.results);
      setSelected(new Set());
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!report && !error) return <PageLoader label="Checking score sheets…" />;

  const teachers = report?.teachers || [];
  const allSelected = teachers.length > 0 && teachers.every((t) => selected.has(t.userId));

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Late Score Sheets</h2>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Teachers with score sheets that are not fully submitted
          {report ? ` for ${TERM_LABEL[report.term] || report.term}, ${report.session}` : ""}. A sheet is one subject in one class; it is complete when every student&rsquo;s scores are submitted or approved.
        </p>
        {report && (
          <p className="text-xs font-semibold text-slate-600 mt-2">
            {report.completeSheets} of {report.totalSheets} sheets complete · {teachers.length} teacher{teachers.length === 1 ? "" : "s"} with work outstanding
          </p>
        )}
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

      {results.length > 0 && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-1">
          {results.map((r, i) => (
            <div key={i}>
              <strong>{r.name || "Teacher"}</strong>: {r.detail}
            </div>
          ))}
        </div>
      )}

      {report && !report.emailConfigured && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
          Email isn&rsquo;t configured on this server, so reminders go out in the portal only (the teacher&rsquo;s notification bell and push).
        </div>
      )}

      {teachers.length === 0 ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-10 text-center text-emerald-700 text-sm font-semibold">Every assigned score sheet is complete.</div>
      ) : (
        <>
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(teachers.map((t) => t.userId)))} />
                Select all
              </label>
              <button
                type="button"
                onClick={remind}
                disabled={busy || !selected.size}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40"
              >
                {busy ? "Sending…" : `Remind ${selected.size || ""} selected teacher${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Optional note added to the reminder, e.g. “Please submit by Friday.”"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <p className="text-[11px] text-slate-400">Each reminder lists that teacher&rsquo;s own sheets. A teacher can only be reminded once every 12 hours.</p>
          </div>

          <div className="space-y-3">
            {teachers.map((t) => (
              <div key={t.userId} className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={selected.has(t.userId)} onChange={() => toggle(t.userId)} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-sm font-bold text-slate-900">{t.name}</span>
                      <span className="text-[11px] text-slate-500">{t.email || "no email on file"}</span>
                      <span className="text-[11px] font-semibold text-rose-700">{t.sheets.length} sheet{t.sheets.length === 1 ? "" : "s"} outstanding</span>
                      {t.lastRemindedAt && <span className="text-[11px] text-slate-400">reminded {ago(t.lastRemindedAt)}</span>}
                    </span>
                    <span className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {t.sheets.map((s) => (
                        <span key={`${s.classId}:${s.subjectId}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-xs">
                          <span className="min-w-0">
                            <span className="font-semibold text-slate-800">{s.subjectName}</span> <span className="text-slate-500">· {s.className}</span>
                            <span className="block text-[11px] text-slate-500">
                              {s.done}/{s.expected} submitted{s.draft ? ` · ${s.draft} draft` : ""}
                              {s.returned ? ` · ${s.returned} returned` : ""}
                            </span>
                          </span>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${STATE_STYLE[s.state]}`}>{STATE_LABEL[s.state]}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                </label>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
