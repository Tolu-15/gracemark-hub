"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/supabase/client";
import { PageLoader } from "@/components/shared/PageLoader";

interface Setup {
  session: string;
  term: string;
  termLabel: string;
  next: { term: string; label: string } | null;
  terms: { term: string; label: string; schoolDays: number | null; nextTermBegins: string | null; teachersCanEdit: boolean }[];
  scores: { draft: number; submitted: number; approved: number; returned: number };
  unpublishedClasses: string[];
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(await getAuthHeaders()), ...(init?.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function Check({ ok, title, children }: { ok: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className={`flex items-start gap-3 rounded-xl border p-3 ${ok ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
      <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full text-[11px] font-black flex items-center justify-center text-white ${ok ? "bg-emerald-600" : "bg-amber-500"}`}>{ok ? "✓" : "!"}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        {children && <span className="block text-xs text-slate-600 mt-0.5">{children}</span>}
      </span>
    </li>
  );
}

export default function TermSetupPage() {
  const [data, setData] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState("120");
  const [begins, setBegins] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { res, json } = await api("/api/admin/term-setup");
    if (!res.ok || !json.ok) return setError(json.error || "Could not load the term setup.");
    setError(null);
    setData(json);
    const finishing = (json.terms as Setup["terms"]).find((t) => t.term === json.term);
    if (finishing?.nextTermBegins) setBegins(finishing.nextTermBegins);
    const upcoming = (json.terms as Setup["terms"]).find((t) => t.term === json.next?.term);
    if (upcoming?.schoolDays) setDays(String(upcoming.schoolDays));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data && !error) return <PageLoader label="Checking the term…" />;
  if (!data) return <div className="max-w-3xl mx-auto p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>;

  const open = data.scores.draft + data.scores.submitted + data.scores.returned;
  const lastTerm = !data.next;

  async function advance() {
    if (!data?.next) return;
    if (!window.confirm(`Move ${data.session} from ${data.termLabel} to ${data.next.label}? Teachers will no longer be able to edit ${data.termLabel} scores unless you unlock it again.`)) return;
    setBusy(true);
    setError(null);
    try {
      const { res, json } = await api("/api/admin/term-setup", { method: "POST", body: JSON.stringify({ school_days: Number(days), next_term_begins: begins || null, acknowledge: ack }) });
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not move to the next term.");
      setDone(`The school is now in ${json.label}.`);
      setAck(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">{lastTerm ? "End of Year" : "Start the Next Term"}</h2>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Right now: <strong className="text-slate-800">{data.termLabel}, {data.session}</strong>.{" "}
          {lastTerm ? "This is the last term. Finish the year with the steps below." : `Check the list, set the dates, then move to ${data.next!.label}.`}
        </p>
      </div>

      {done && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">{done}</div>}
      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-slate-900">1. Is {data.termLabel} finished?</h3>
        <ul className="space-y-2">
          <Check ok={open === 0} title={open === 0 ? "All scores are approved" : `${open} score${open === 1 ? "" : "s"} are not approved yet`}>
            {open === 0 ? `${data.scores.approved} approved.` : (
              <>
                {data.scores.draft} draft, {data.scores.submitted} waiting for approval, {data.scores.returned} returned.{" "}
                <Link href="/admin/late-sheets" className="underline font-semibold">Chase late teachers</Link> ·{" "}
                <Link href="/admin/approvals" className="underline font-semibold">Approve scores</Link>
              </>
            )}
          </Check>
          <Check ok={data.unpublishedClasses.length === 0} title={data.unpublishedClasses.length === 0 ? "Every class has its Terminal Result published" : `Terminal Result not published for ${data.unpublishedClasses.length} class${data.unpublishedClasses.length === 1 ? "" : "es"}`}>
            {data.unpublishedClasses.length === 0 ? "" : (
              <>
                {data.unpublishedClasses.join(", ")}. <Link href="/admin/approvals" className="underline font-semibold">Publish results</Link>
              </>
            )}
          </Check>
        </ul>
      </div>

      {lastTerm ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-3">
          <h3 className="text-sm font-bold text-slate-900">2. Close the year</h3>
          <ol className="list-decimal pl-5 text-sm text-slate-700 space-y-1.5">
            <li>
              Publish every class&rsquo;s Terminal Result (<Link href="/admin/approvals" className="underline font-semibold">Approvals</Link>).
            </li>
            <li>
              Create the new session on the <Link href="/admin/dashboard" className="underline font-semibold">Dashboard</Link> and make it current.
            </li>
            <li>
              Move students up with <Link href="/admin/promotions" className="underline font-semibold">Class Promotions</Link>.
            </li>
            <li>
              Then come back here for <strong>1st Term</strong> of the new session.
            </li>
          </ol>
        </div>
      ) : (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900">2. Dates</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {data.next!.label} begins (printed on {data.termLabel} reports)
              <input type="date" value={begins} onChange={(e) => setBegins(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800" />
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              School days in {data.next!.label}
              <input type="number" min={1} max={250} value={days} onChange={(e) => setDays(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800" />
            </label>
          </div>

          <h3 className="text-sm font-bold text-slate-900 pt-1">3. What will change</h3>
          <ul className="text-xs text-slate-600 list-disc pl-5 space-y-1">
            <li>The current term becomes <strong>{data.next!.label}</strong> everywhere (score entry, attendance, dashboards).</li>
            <li>
              <strong>{data.termLabel}</strong> is locked for teachers. Admins can unlock it later from the Dashboard if a correction is needed.
            </li>
            <li>The resumption date and school days above are saved.</li>
          </ul>

          {open > 0 && (
            <label className="flex items-start gap-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />I understand {open} score{open === 1 ? " is" : "s are"} still not approved and want to move on anyway.
            </label>
          )}
          <button
            type="button"
            onClick={advance}
            disabled={busy || (open > 0 && !ack) || !days}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-sm cursor-pointer disabled:opacity-40"
          >
            {busy ? "Moving…" : `Start ${data.next!.label}`}
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 mb-2">Terms in {data.session}</h3>
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          {data.terms.map((t) => (
            <div key={t.term} className={`rounded-xl border p-3 ${t.term === data.term ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
              <div className="font-bold text-slate-900">
                {t.label} {t.term === data.term && <span className="text-emerald-700">(current)</span>}
              </div>
              <div className="text-slate-600 mt-1">School days: {t.schoolDays ?? "not set"}</div>
              <div className="text-slate-600">Next term begins: {t.nextTermBegins || "not set"}</div>
              <div className="text-slate-600">{t.term === data.term ? "Open for teachers" : t.teachersCanEdit ? "Unlocked for teachers" : "Locked for teachers"}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
