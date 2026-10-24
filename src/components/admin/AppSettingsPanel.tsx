"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";

interface CardSettings {
  price: number;
  viewsAllowed: number;
  onlineEnabled: boolean;
}
interface Maintenance {
  enabled: boolean;
  message: string;
  backAt: string | null;
  allowAdmins: boolean;
}

async function call(method: "GET" | "PUT", body?: unknown) {
  const res = await fetch("/api/admin/dev-tools/settings", {
    method,
    headers: { ...(await getAuthHeaders()), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || "Request failed.");
  return json;
}

/** ISO string -> value for <input type="datetime-local"> in the browser's own timezone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Developer-only: scratch card price/views/online switch and maintenance mode, without touching code. */
export default function AppSettingsPanel() {
  const [card, setCard] = useState<CardSettings>({ price: 1000, viewsAllowed: 5, onlineEnabled: false });
  const [maint, setMaint] = useState<Maintenance>({ enabled: false, message: "", backAt: null, allowAdmins: false });
  const [paystackConfigured, setPaystackConfigured] = useState(false);
  const [storeReady, setStoreReady] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const json = await call("GET");
      setCard(json.card);
      setMaint(json.maintenance);
      setPaystackConfigured(Boolean(json.paystackConfigured));
      setStoreReady(Boolean(json.storeReady));
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(section: "scratch_card" | "maintenance", value: unknown, confirmText: string | null, done: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(section);
    setMessage(null);
    try {
      await call("PUT", { section, value });
      setMessage({ kind: "ok", text: done });
      await load();
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">App Settings</h2>
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-6">
        {!storeReady && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
            The settings table doesn&rsquo;t exist yet, so changes can&rsquo;t be saved. Run <code>supabase/041_system_settings.sql</code> first. Until then the app uses the built-in defaults (₦1,000, 5 views, maintenance off).
          </div>
        )}
        {message && (
          <div className={`p-3 rounded-xl border text-xs font-semibold ${message.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-700"}`}>
            {message.text}
          </div>
        )}

        {/* Scratch cards */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Scratch cards</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Price (₦)
              <input
                type="number"
                min={50}
                step={50}
                value={card.price}
                onChange={(e) => setCard({ ...card, price: Number(e.target.value) })}
                className="mt-1 block w-32 px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800"
              />
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Views per card
              <input
                type="number"
                min={1}
                max={50}
                value={card.viewsAllowed}
                onChange={(e) => setCard({ ...card, viewsAllowed: Number(e.target.value) })}
                className="mt-1 block w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 pb-2">
              <input
                type="checkbox"
                checked={card.onlineEnabled}
                disabled={!paystackConfigured}
                onChange={(e) => setCard({ ...card, onlineEnabled: e.target.checked })}
              />
              Online (Paystack) sales {paystackConfigured ? "" : "(no Paystack key set)"}
            </label>
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                save(
                  "scratch_card",
                  card,
                  `Set the card price to ₦${card.price} with ${card.viewsAllowed} views, online sales ${card.onlineEnabled ? "ON" : "OFF"}? New purchases use this; cards already bought keep what they were sold with.`,
                  "Scratch card settings saved."
                )
              }
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-50"
            >
              {busy === "scratch_card" ? "Saving…" : "Save card settings"}
            </button>
          </div>
          <p className="text-[11px] text-slate-400">A new price or view count only applies to cards sold from now on. Admins can see the price in Scratch Cards but can&rsquo;t change it.</p>
        </div>

        {/* Maintenance */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">Maintenance mode</h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${maint.enabled ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
              {maint.enabled ? "On: users see the under construction page" : "Off"}
            </span>
          </div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Message to users (optional)
            <textarea
              value={maint.message}
              onChange={(e) => setMaint({ ...maint, message: e.target.value })}
              rows={2}
              maxLength={500}
              placeholder="We are upgrading the portal. Results are safe and will be back shortly."
              className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800"
            />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Expected back (optional)
              <input
                type="datetime-local"
                value={toLocalInput(maint.backAt)}
                onChange={(e) => setMaint({ ...maint, backAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="mt-1 block px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 pb-2">
              <input type="checkbox" checked={maint.allowAdmins} onChange={(e) => setMaint({ ...maint, allowAdmins: e.target.checked })} />
              Let admins in too (only you by default)
            </label>
            {maint.enabled ? (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => save("maintenance", { ...maint, enabled: false }, null, "Maintenance mode is off. The portal is open again.")}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-50"
              >
                {busy === "maintenance" ? "Saving…" : "Turn maintenance OFF"}
              </button>
            ) : (
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  save(
                    "maintenance",
                    { ...maint, enabled: true },
                    "Turn maintenance mode ON? Teachers, students and (unless allowed) other admins will see the under construction page within a minute. You can still use the app.",
                    "Maintenance mode is on. Everyone else now sees the under construction page."
                  )
                }
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-50"
              >
                {busy === "maintenance" ? "Saving…" : "Turn maintenance ON"}
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            Paystack payment confirmations are still accepted while maintenance is on. If the whole site is down, this page can&rsquo;t show: use your hosting provider&rsquo;s maintenance page instead.
          </p>
        </div>
      </div>
    </div>
  );
}
