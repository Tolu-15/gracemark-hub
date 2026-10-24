"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";

type Group = "teachers" | "admins" | "guardians";
interface Recipient {
  email: string;
  name: string;
  detail: string;
}

const GROUP_LABEL: Record<Group, string> = { teachers: "Teachers", admins: "Admins", guardians: "Guardians" };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { ...(await getAuthHeaders()), ...(init?.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

/**
 * Developer-only: pick teachers, admins or guardians from the database and email them. Always send
 * a test to yourself first. One email per person, so nobody sees anyone else's address.
 */
export default function EmailComposer() {
  const [group, setGroup] = useState<Group>("teachers");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<{ configured: boolean; maxRecipients: number; counts: Record<Group, number>; lists: Record<Group, Recipient[]> } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [failures, setFailures] = useState<{ email: string; error?: string }[]>([]);

  const load = useCallback(async () => {
    const { res, json } = await api(`/api/admin/dev-tools/email${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`);
    if (!res.ok || !json.ok) {
      setNotice({ kind: "error", text: json.error || "Could not load recipients." });
      return;
    }
    setData({
      configured: Boolean(json.configured),
      maxRecipients: json.maxRecipients,
      counts: json.counts,
      lists: { teachers: json.teachers, admins: json.admins, guardians: json.guardians },
    });
  }, [query]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const shown = data?.lists[group] || [];
  const key = (r: Recipient) => r.email.toLowerCase();
  const shownSelected = useMemo(() => shown.filter((r) => selected.has(key(r))).length, [shown, selected]);

  function toggle(r: Recipient) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key(r)) ? next.delete(key(r)) : next.add(key(r));
      return next;
    });
  }
  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = shown.length > 0 && shown.every((r) => next.has(key(r)));
      shown.forEach((r) => (allOn ? next.delete(key(r)) : next.add(key(r))));
      return next;
    });
  }

  // Selected addresses across every group, in their original casing.
  const selectedEmails = useMemo(() => {
    const out: string[] = [];
    (["teachers", "admins", "guardians"] as Group[]).forEach((g) => data?.lists[g].forEach((r) => selected.has(key(r)) && out.push(r.email)));
    return Array.from(new Map(out.map((e) => [e.toLowerCase(), e])).values());
  }, [data, selected]);

  async function send(test: boolean) {
    if (!subject.trim() || !message.trim()) {
      setNotice({ kind: "error", text: "Write a subject and a message first." });
      return;
    }
    if (!test && !window.confirm(`Send this email to ${selectedEmails.length} recipient${selectedEmails.length === 1 ? "" : "s"}? Each person gets their own copy. This cannot be undone.`)) return;
    setBusy(test ? "test" : "send");
    setNotice(null);
    setFailures([]);
    try {
      const { res, json } = await api("/api/admin/dev-tools/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, test, emails: test ? undefined : selectedEmails }),
      });
      if (!res.ok || !json.ok) throw new Error(json.error || "Send failed.");
      setFailures(json.results || []);
      setNotice({
        kind: json.failed ? "error" : "ok",
        text: test ? (json.sent ? "Test sent to your own email. Check your inbox (and spam)." : "The test email failed.") : `Sent ${json.sent} email${json.sent === 1 ? "" : "s"}${json.failed ? `, ${json.failed} failed` : ""}.`,
      });
    } catch (e: any) {
      setNotice({ kind: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Send Email</h2>
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-4">
        {data && !data.configured && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
            Email is not configured on this server (BREVO_API_KEY missing), so nothing can be sent from here.
          </div>
        )}
        {notice && (
          <div className={`p-3 rounded-xl border text-xs font-semibold ${notice.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-700"}`}>
            {notice.text}
            {failures.length > 0 && <ul className="mt-1 font-normal list-disc pl-4">{failures.slice(0, 8).map((f) => <li key={f.email}>{f.email}: {f.error}</li>)}</ul>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" className="inline-flex rounded-xl bg-slate-100 p-1">
            {(Object.keys(GROUP_LABEL) as Group[]).map((g) => (
              <button
                key={g}
                role="tab"
                aria-selected={group === g}
                type="button"
                onClick={() => setGroup(g)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${group === g ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              >
                {GROUP_LABEL[g]} {data ? `(${data.counts[g]})` : ""}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email…"
            className="flex-1 min-w-[160px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <button type="button" onClick={toggleAllShown} disabled={!shown.length} className="px-3 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 cursor-pointer disabled:opacity-40">
            {shown.length > 0 && shownSelected === shown.length ? "Unselect shown" : "Select all shown"}
          </button>
        </div>

        <div className="border border-slate-200 rounded-xl max-h-64 overflow-y-auto divide-y divide-slate-100">
          {shown.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">{data ? "No one matches." : "Loading…"}</div>
          ) : (
            shown.map((r) => (
              <label key={key(r)} className="flex items-start gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(key(r))} onChange={() => toggle(r)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900 truncate">{r.name}</span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    {r.email}
                    {r.detail ? ` · ${r.detail}` : ""}
                  </span>
                </span>
              </label>
            ))
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          <strong>{selectedEmails.length}</strong> selected across all groups (max {data?.maxRecipients ?? 100} per send).
          {selectedEmails.length > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} className="ml-2 underline cursor-pointer">
              Clear
            </button>
          )}
        </p>

        <div className="space-y-2">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={150}
            placeholder="Subject"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            rows={6}
            placeholder="Write your message. Teachers and admins are greeted by name; guardians get “Dear Guardian”."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => send(true)}
            disabled={!!busy || !data?.configured}
            className="px-4 py-2 border border-slate-300 text-slate-800 font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40"
          >
            {busy === "test" ? "Sending test…" : "Send test to me"}
          </button>
          <button
            type="button"
            onClick={() => send(false)}
            disabled={!!busy || !data?.configured || selectedEmails.length === 0}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40"
          >
            {busy === "send" ? "Sending…" : `Send to ${selectedEmails.length} recipient${selectedEmails.length === 1 ? "" : "s"}`}
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          Always send a test to yourself first. Only school notices, please: guardians&rsquo; emails are personal data. Every send is logged (who, how many, subject), not the addresses.
        </p>
      </div>
    </div>
  );
}
