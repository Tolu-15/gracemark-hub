"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

export default function AdminPortalAccessSettingsPage() {
  const [restrictFees, setRestrictFees] = useState(true);
  const [lockAfterDueDate, setLockAfterDueDate] = useState(false);
  const [gracePeriodDays, setGracePeriodDays] = useState(7);
  const [autoUnlockOnFullPayment, setAutoUnlockOnFullPayment] = useState(true);
  const [settingsRowId, setSettingsRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    async function loadSettings() {
      try {
        const { data } = await supabase
          .from("portal_access_settings")
          .select("*")
          .limit(1)
          .maybeSingle();

        if (data) {
          setSettingsRowId(data.id);
          setRestrictFees(Boolean(data.restrict_outstanding_fees));
          setLockAfterDueDate(Boolean(data.lock_after_due_date));
          setGracePeriodDays(data.grace_period_days ?? 7);
          setAutoUnlockOnFullPayment(Boolean(data.auto_unlock_on_full_payment));
        }
      } catch (err) {
        console.error("Failed to load portal access settings:", err);
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedMsg("");

    const payload = {
      restrict_outstanding_fees: restrictFees,
      lock_after_due_date: lockAfterDueDate,
      grace_period_days: Number(gracePeriodDays || 0),
      auto_unlock_on_full_payment: autoUnlockOnFullPayment,
      updated_at: new Date().toISOString(),
    };

    try {
      if (settingsRowId) {
        const { error } = await supabase
          .from("portal_access_settings")
          .update(payload)
          .eq("id", settingsRowId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("portal_access_settings")
          .insert([payload])
          .select()
          .single();
        if (error) throw error;
        if (data?.id) setSettingsRowId(data.id);
      }

      setSavedMsg("Portal access policies saved successfully!");
      setTimeout(() => setSavedMsg(""), 4000);
    } catch (err: any) {
      alert("Failed to save settings: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Portal Access &amp; Lock Policies</h2>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Define automatic lock enforcement rules for students with outstanding school fees balances.
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs">
        {loading ? (
          <div className="py-12 text-center text-slate-400">Loading access policy…</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6 text-sm">
            {savedMsg && (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                <span>{savedMsg}</span>
              </div>
            )}

            {/* Toggle 1 */}
            <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-50/70 border border-slate-200">
              <div>
                <span className="font-bold text-slate-900 block">Restrict Access on Unpaid Balance</span>
                <p className="text-xs text-slate-500 mt-0.5">
                  When enabled, students with unpaid tuition balances cannot view academic report cards or examination results.
                </p>
              </div>
              <input
                type="checkbox"
                checked={restrictFees}
                onChange={(e) => setRestrictFees(e.target.checked)}
                className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 mt-1 cursor-pointer"
              />
            </div>

            {/* Toggle 2 */}
            <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-50/70 border border-slate-200">
              <div>
                <span className="font-bold text-slate-900 block">Enforce Deadline Lock</span>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically lock the portal only after the configured fee payment due date has passed.
                </p>
              </div>
              <input
                type="checkbox"
                checked={lockAfterDueDate}
                onChange={(e) => setLockAfterDueDate(e.target.checked)}
                className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 mt-1 cursor-pointer"
              />
            </div>

            {/* Grace Period */}
            <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-2">
              <label className="font-bold text-slate-900 block">Grace Period (Days)</label>
              <p className="text-xs text-slate-500">
                Number of allowable grace days following term resumption before automated financial lock kicks in.
              </p>
              <input
                type="number"
                min="0"
                max="60"
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(Number(e.target.value))}
                className="w-32 px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:outline-none"
              />
            </div>

            {/* Toggle 3 */}
            <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-50/70 border border-slate-200">
              <div>
                <span className="font-bold text-slate-900 block">Instant Unlock on Full Payment</span>
                <p className="text-xs text-slate-500 mt-0.5">
                  Instantly restore full portal and report card privileges as soon as Paystack payment or bank verification clears.
                </p>
              </div>
              <input
                type="checkbox"
                checked={autoUnlockOnFullPayment}
                onChange={(e) => setAutoUnlockOnFullPayment(e.target.checked)}
                className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 mt-1 cursor-pointer"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs sm:text-sm rounded-xl transition shadow-xs disabled:opacity-50"
              >
                {saving ? "Saving Policy…" : "Save Policy Settings"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
