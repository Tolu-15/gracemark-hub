"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import { PageLoader } from "@/components/shared/PageLoader";

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];
const termLabel = (t: string) => TERMS.find((x) => x.value === t)?.label || t;
const naira = (n: number) => `₦${Number(n || 0).toLocaleString("en-NG")}`;
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

interface Card {
  id: string;
  serial: string;
  studentName: string;
  admissionNo: string;
  session: string;
  term: string;
  viewsAllowed: number;
  viewsUsed: number;
  source: "online" | "offline" | "complimentary";
  status: "issued" | "active" | "exhausted" | "revoked";
  amountPaid: number;
  issuedBy: string | null;
  createdAt: string;
}
interface RevenueRow {
  session: string;
  term: string;
  online: number;
  offline: number;
  complimentary: number;
  revenue: number;
}
interface Attention {
  reference: string;
  status: string;
  amount: number;
  createdAt: string;
  studentName: string;
  admissionNo: string;
}
interface StudentHit {
  id: string;
  name: string;
  admission_no: string;
  classes?: { name: string } | { name: string }[] | null;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()), ...(init?.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

const STATUS_STYLE: Record<Card["status"], string> = {
  issued: "bg-sky-50 text-sky-800 border-sky-200",
  active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  exhausted: "bg-slate-100 text-slate-600 border-slate-200",
  revoked: "bg-rose-50 text-rose-700 border-rose-200",
};

export default function AdminScratchCardsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [attention, setAttention] = useState<Attention[]>([]);
  const [canIssue, setCanIssue] = useState(false);
  const [price, setPrice] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Issue form
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [picked, setPicked] = useState<StudentHit | null>(null);
  const [term, setTerm] = useState("term1");
  const [source, setSource] = useState<"offline" | "complimentary">("offline");
  const [issued, setIssued] = useState<{ pin: string; serial: string; studentName: string; admissionNo: string; term: string; session: string; source: string } | null>(null);

  // Filters
  const [filter, setFilter] = useState<"all" | Card["status"]>("all");

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const { res, json } = await api("/api/admin/scratch-cards");
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load scratch cards.");
      setCards(json.cards || []);
      setRevenue(json.revenue || []);
      setAttention(json.needsAttention || []);
      setCanIssue(Boolean(json.canIssue));
      setPrice(json.price || 1000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    getAppSettings().then((s) => s?.current_term && setTerm(s.current_term)).catch(() => {});
  }, [load]);

  // Student lookup by name or admission number.
  useEffect(() => {
    const q = search.trim();
    if (picked || q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const safe = q.replace(/[%,()]/g, " ");
      const { data } = await supabase
        .from("students")
        .select("id, name, admission_no, classes:class_id(name)")
        .or(`name.ilike.%${safe}%,admission_no.ilike.%${safe}%`)
        .limit(8);
      setHits((data as any) || []);
    }, 250);
    return () => clearTimeout(t);
  }, [search, picked]);

  async function issue() {
    if (!picked) return;
    if (source === "offline" && !window.confirm(`Confirm you have received ${naira(price)} from the parent of ${picked.name} for ${termLabel(term)}.`)) return;
    setBusy("issue");
    setError(null);
    try {
      const { res, json } = await api("/api/admin/scratch-cards", {
        method: "POST",
        body: JSON.stringify({ student_id: picked.id, term, source, amount_received: source === "offline" ? price : 0 }),
      });
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not issue the card.");
      setIssued({ pin: json.pin, ...json.card });
      setPicked(null);
      setSearch("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(card: Card) {
    const reason = window.prompt(`Revoke card ${card.serial} for ${card.studentName}? Enter a reason (optional):`);
    if (reason === null) return;
    setBusy(`revoke:${card.id}`);
    try {
      const { res, json } = await api("/api/admin/scratch-cards", { method: "PATCH", body: JSON.stringify({ card_id: card.id, reason }) });
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not revoke the card.");
      flash(`Card ${card.serial} revoked.`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const shown = useMemo(() => cards.filter((c) => filter === "all" || c.status === filter), [cards, filter]);
  const totalRevenue = revenue.reduce((sum, r) => sum + r.revenue, 0);

  if (loading) return <PageLoader label="Loading scratch cards…" />;

  return (
    <>
      <div className="space-y-5 max-w-6xl mx-auto print:hidden">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Scratch Cards</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Terminal Result cards: {naira(price)} each, 5 views per term, tied to one student. Online sales appear here automatically; cash sales are issued below.
          </p>
        </div>

        {toast && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">{toast}</div>}
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex justify-between gap-3">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="cursor-pointer" aria-label="Dismiss">
              &times;
            </button>
          </div>
        )}

        {attention.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
            <h3 className="text-sm font-bold text-amber-900">Needs your attention ({attention.length})</h3>
            <ul className="text-xs text-amber-900 space-y-1">
              {attention.map((a) => (
                <li key={a.reference}>
                  <strong>{a.studentName || "Unknown student"}</strong> ({a.admissionNo}) · {naira(a.amount)} · {a.reference} ·{" "}
                  {a.status === "duplicate"
                    ? "paid, but the student already had a card for that term. Refund or credit it."
                    : `payment started ${fmt(a.createdAt)} and is still unconfirmed. Check it in Paystack.`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Revenue */}
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Sales by term</h3>
            <span className="text-xs font-semibold text-slate-600">Total received: {naira(totalRevenue)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-left">
                  <th className="px-4 py-2.5">Session</th>
                  <th className="px-2 py-2.5">Term</th>
                  <th className="px-2 py-2.5 text-center">Online</th>
                  <th className="px-2 py-2.5 text-center">Offline</th>
                  <th className="px-2 py-2.5 text-center">Free</th>
                  <th className="px-4 py-2.5 text-right">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {revenue.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No cards sold yet.
                    </td>
                  </tr>
                ) : (
                  revenue.map((r) => (
                    <tr key={`${r.session}|${r.term}`}>
                      <td className="px-4 py-2.5 font-semibold text-slate-800">{r.session}</td>
                      <td className="px-2 py-2.5">{termLabel(r.term)}</td>
                      <td className="px-2 py-2.5 text-center">{r.online}</td>
                      <td className="px-2 py-2.5 text-center">{r.offline}</td>
                      <td className="px-2 py-2.5 text-center">{r.complimentary}</td>
                      <td className="px-4 py-2.5 text-right font-bold">{naira(r.revenue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Issue */}
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Issue a card</h3>
          {!canIssue ? (
            <p className="text-xs text-slate-500">Only the authorised card issuers can issue or revoke cards. You can view sales here.</p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2 relative">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Student
                    <input
                      value={picked ? `${picked.name} (${picked.admission_no})` : search}
                      onChange={(e) => {
                        setPicked(null);
                        setSearch(e.target.value);
                      }}
                      placeholder="Search name or admission number"
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800"
                    />
                  </label>
                  {hits.length > 0 && (
                    <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-auto">
                      {hits.map((h) => (
                        <li key={h.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setPicked(h);
                              setHits([]);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                          >
                            <span className="font-semibold text-slate-900">{h.name}</span>{" "}
                            <span className="text-xs text-slate-500">
                              {h.admission_no} · {(Array.isArray(h.classes) ? h.classes[0]?.name : h.classes?.name) || ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Term
                  <select value={term} onChange={(e) => setTerm(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800">
                    {TERMS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Type
                  <select value={source} onChange={(e) => setSource(e.target.value as any)} className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800">
                    <option value="offline">Paid at the office ({naira(price)})</option>
                    <option value="complimentary">Free (staff child / hardship)</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                onClick={issue}
                disabled={!picked || !!busy}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
              >
                {busy === "issue" ? "Issuing…" : "Issue card and show PIN"}
              </button>
              <p className="text-[11px] text-slate-500">The card is for the current session. The PIN is shown once and cannot be looked up later; to replace a lost card, revoke it and issue a new one.</p>
            </>
          )}
        </div>

        {/* Cards */}
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">All cards ({shown.length})</h3>
            <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold">
              <option value="all">All statuses</option>
              <option value="issued">Issued (not yet activated)</option>
              <option value="active">Active</option>
              <option value="exhausted">Used up</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-left">
                  <th className="px-4 py-2.5">Student</th>
                  <th className="px-2 py-2.5">Card</th>
                  <th className="px-2 py-2.5">Term</th>
                  <th className="px-2 py-2.5">Source</th>
                  <th className="px-2 py-2.5 text-center">Views</th>
                  <th className="px-2 py-2.5">Status</th>
                  <th className="px-2 py-2.5 text-right">Paid</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      No cards to show.
                    </td>
                  </tr>
                ) : (
                  shown.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">{c.studentName}</div>
                        <div className="text-[11px] text-slate-500">{c.admissionNo}</div>
                      </td>
                      <td className="px-2 py-2.5 font-mono text-[11px]">
                        {c.serial}
                        <div className="text-slate-400 font-sans">{fmt(c.createdAt)}</div>
                      </td>
                      <td className="px-2 py-2.5">
                        {termLabel(c.term)}
                        <div className="text-[11px] text-slate-500">{c.session}</div>
                      </td>
                      <td className="px-2 py-2.5 capitalize">
                        {c.source === "complimentary" ? "free" : c.source}
                        {c.issuedBy && <div className="text-[11px] text-slate-400 normal-case">{c.issuedBy}</div>}
                      </td>
                      <td className="px-2 py-2.5 text-center tabular-nums">
                        {c.viewsUsed}/{c.viewsAllowed}
                      </td>
                      <td className="px-2 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${STATUS_STYLE[c.status]}`}>{c.status === "exhausted" ? "used up" : c.status}</span>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{naira(c.amountPaid)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {canIssue && (c.status === "issued" || c.status === "active") && (
                          <button
                            type="button"
                            disabled={!!busy}
                            onClick={() => revoke(c)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 rounded-md disabled:opacity-40 cursor-pointer"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* PIN popup (screen) */}
      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 print:hidden">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 border border-slate-200 space-y-3">
            <h3 className="font-bold text-slate-900">Card issued</h3>
            <p className="text-xs text-slate-600">
              {issued.studentName} ({issued.admissionNo}) · {termLabel(issued.term)} {issued.session}
            </p>
            <div className="rounded-xl bg-slate-900 text-white text-center py-4">
              <div className="text-[10px] uppercase tracking-widest text-slate-400">PIN</div>
              <div className="text-2xl font-mono font-bold tracking-widest mt-1">{issued.pin}</div>
            </div>
            <p className="text-[11px] text-rose-700 font-semibold">Write this PIN down or print the slip now. It cannot be shown again.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => navigator.clipboard?.writeText(issued.pin)} className="px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg cursor-pointer">
                Copy PIN
              </button>
              <button type="button" onClick={() => window.print()} className="px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg cursor-pointer">
                Print slip
              </button>
              <button type="button" onClick={() => setIssued(null)} className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg cursor-pointer">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIN slip (print only) */}
      {issued && (
        <div className="hidden print:block p-8">
          <div className="max-w-sm border-2 border-dashed border-slate-500 p-6 text-center space-y-2">
            <div className="text-sm font-bold">Gracemark Academy · Result Scratch Card</div>
            <div className="text-xs">
              {issued.studentName} ({issued.admissionNo})
            </div>
            <div className="text-xs">
              {termLabel(issued.term)} {issued.session} · Terminal Result · 5 views
            </div>
            <div className="text-2xl font-mono font-bold tracking-widest py-3">{issued.pin}</div>
            <div className="text-[10px]">Serial {issued.serial} · Log in to the student portal, open Results, and enter this PIN.</div>
          </div>
        </div>
      )}
    </>
  );
}
