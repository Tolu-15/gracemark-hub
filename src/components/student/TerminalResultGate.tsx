"use client";

import React, { useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/supabase/client";

export interface TrCardInfo {
  id: string;
  serial: string;
  status: "issued" | "active" | "exhausted" | "revoked";
  viewsAllowed: number;
  viewsUsed: number;
  viewsLeft: number;
}

export interface TrInfo {
  published: boolean;
  card?: TrCardInfo | null;
  price?: number;
  viewsAllowed?: number;
  onlineEnabled?: boolean;
  pendingReference?: string;
}

interface Props {
  session: string;
  term: string;
  termLabel: string;
  studentName?: string;
  tr: TrInfo;
  /** Called with the report once a view has been used. */
  onOpened: (report: any, card: TrCardInfo) => void;
  /** Reload the report data (after a PIN is accepted or a payment finishes). */
  onRefresh: () => void;
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

/**
 * Shown on the Terminal tab until a scratch card view is used. The result itself only arrives from
 * /api/student/scratch-card/view; this component never has it before then.
 */
export default function TerminalResultGate({ session, term, termLabel, studentName, tr, onOpened, onRefresh }: Props) {
  const card = tr.card || null;
  const price = tr.price ?? 1000;
  const [paymentRef, setPaymentRef] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<"redeem" | "pay" | "view" | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function redeem() {
    setBusy("redeem");
    setMessage(null);
    try {
      const { res, json } = await post("/api/student/scratch-card/redeem", { pin });
      if (!res.ok || !json.ok) throw new Error(json.error || "That PIN was not accepted.");
      setPin("");
      setMessage({ kind: "info", text: "Card activated." });
      onRefresh();
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function openResult() {
    setBusy("view");
    setMessage(null);
    try {
      const { res, json } = await post("/api/student/scratch-card/view", { session, term });
      if (!res.ok || !json.ok) {
        if (json.needsCard) onRefresh();
        throw new Error(json.error || "Could not open the result. Please try again.");
      }
      onOpened(json.report, json.card);
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function payOnline() {
    setBusy("pay");
    setMessage(null);
    try {
      const { res, json } = await post("/api/student/scratch-card/start", { session, term, previousReference: tr.pendingReference });
      if (json.hasCard || json.pendingReference) {
        onRefresh();
        setBusy(null);
        return;
      }
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not start the payment.");
      if (!json.authorizationUrl) throw new Error("Paystack did not return a checkout link.");
      window.location.assign(json.authorizationUrl);
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message });
      setBusy(null);
    }
  }

  const heading = (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Terminal Result</p>
      <h3 className="text-lg font-bold text-slate-900">
        {termLabel} {session}
        {studentName ? ` · ${studentName}` : ""}
      </h3>
    </div>
  );

  const pinBox = (
    <div className="space-y-2">
      <label className="block text-xs font-bold text-slate-700" htmlFor="scratch-pin">
        {card?.status === "issued" ? "Enter the PIN on your scratch card" : "Already have a PIN from the school?"}
      </label>
      <div className="flex gap-2">
        <input
          id="scratch-pin"
          value={pin}
          onChange={(e) => setPin(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono tracking-wider"
        />
        <button
          type="button"
          onClick={redeem}
          disabled={!!busy || pin.replace(/[^A-Za-z0-9]/g, "").length < 8}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
        >
          {busy === "redeem" ? "Checking…" : "Activate"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-xl mx-auto rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5 shadow-xs">
      {heading}

      {message && (
        <div
          role={message.kind === "error" ? "alert" : "status"}
          className={`p-3 rounded-xl border text-xs font-semibold ${
            message.kind === "error" ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {card?.status === "active" || card?.status === "exhausted" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Your scratch card gives unlimited access to this term’s result, including printing.
          </p>
          <button
            type="button"
            onClick={openResult}
            disabled={!!busy}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold disabled:opacity-40 cursor-pointer"
          >
            View terminal result
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {card?.status === "issued" ? (
            <p className="text-sm text-slate-700">The school has issued you a scratch card for this term. Enter its PIN to activate it.</p>
          ) : (
            <p className="text-sm text-slate-700">
              The terminal result is ready. A scratch card ({naira(price)}) gives unlimited viewing and printing for this term.
            </p>
          )}

          {card?.status === "issued" ? (
            pinBox
          ) : (
            <>
              <div className="space-y-2">
                {tr.pendingReference && (
                  <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <h4 className="font-bold text-slate-900">Check your last payment</h4>
                    <p className="text-sm text-slate-700">You started a checkout for this term. If you paid, check its status before paying again.</p>
                    <p className="break-all font-mono text-xs">{tr.pendingReference}</p>
                    <Link className="inline-block rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white"
                      href={"/student/scratch-card-payment?reference=" + encodeURIComponent(tr.pendingReference)}>
                      Check payment status
                    </Link>
                  </div>
                )}
                {tr.onlineEnabled && (tr.pendingReference ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-semibold">Left checkout before paying?</summary>
                    <button type="button" onClick={payOnline} disabled={!!busy}
                      className="mt-2 rounded-lg border px-4 py-2 font-semibold disabled:opacity-40">
                      {busy === "pay" ? "Opening checkout…" : `Start a new ${naira(price)} checkout`}
                    </button>
                  </details>
                ) : (
                  <button
                    type="button"
                    onClick={payOnline}
                    disabled={!!busy}
                    className="w-full px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-bold disabled:opacity-40 cursor-pointer"
                  >
                    {busy === "pay" ? "Opening payment…" : `Pay ${naira(price)} online`}
                  </button>
                ))}
                <p className="text-xs text-slate-500">
                  {tr.onlineEnabled ? "Or buy" : "Buy"} a card from the school office: pay {naira(price)}, collect your PIN, then enter it below.
                </p>
              </div>
              <details className="text-sm text-slate-700">
                <summary className="cursor-pointer font-semibold">{tr.pendingReference ? "Check a different reference" : "Already paid online?"}</summary>
                <form className="mt-3 space-y-2" onSubmit={(event) => {
                  event.preventDefault();
                  const reference = paymentRef.trim();
                  if (reference) window.location.assign("/student/scratch-card-payment?reference=" + encodeURIComponent(reference));
                }}>
                  <label className="block" htmlFor="payment-reference">Paystack payment reference</label>
                  <input id="payment-reference" required value={paymentRef} onChange={event => setPaymentRef(event.target.value)}
                    className="w-full rounded-lg border px-3 py-2" />
                  <button className="font-semibold underline" type="submit">Check payment status</button>
                </form>
              </details>
              {pinBox}
            </>
          )}
        </div>
      )}


    </div>
  );
}
