"use client";

import React, { useState } from "react";
import Script from "next/script";
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
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<"redeem" | "pay" | "view" | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

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
      const { res, json } = await post("/api/student/scratch-card/view", { session, term, confirm: true });
      if (!res.ok || !json.ok) {
        if (json.needsCard) onRefresh();
        throw new Error(json.error || "Could not open the result. You were not charged.");
      }
      setConfirming(false);
      onOpened(json.report, json.card);
    } catch (e: any) {
      setConfirming(false);
      setMessage({ kind: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function payOnline() {
    setBusy("pay");
    setMessage(null);
    try {
      if (typeof window === "undefined" || !(window as any).PaystackPop) {
        throw new Error("The payment window is still loading. Please try again in a few seconds.");
      }
      const { res, json } = await post("/api/student/scratch-card/start", { session, term });
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not start the payment.");
      if (!json.publicKey || !json.email) throw new Error("Online payment is not set up for this account. Please buy from the school office.");

      const handler = (window as any).PaystackPop.setup({
        key: json.publicKey,
        email: json.email,
        amount: json.amountKobo,
        currency: "NGN",
        ref: json.reference,
        metadata: { purpose: "scratch_card", term, session },
        callback: (response: any) => {
          setMessage({ kind: "info", text: "Payment received. Confirming with the bank…" });
          post("/api/student/scratch-card/verify", { reference: response.reference })
            .then(({ res: vRes, json: vJson }) => {
              if (!vRes.ok || !vJson.ok) {
                setMessage({
                  kind: "info",
                  text: `We could not confirm this payment yet (${vJson.error || "please wait"}). If you were charged, your card will appear on this page shortly. Reference: ${response.reference}`,
                });
              } else {
                setMessage({ kind: "info", text: "Payment confirmed. Your card is ready." });
              }
              onRefresh();
            })
            .catch(() => {
              setMessage({ kind: "info", text: `Payment received but not yet confirmed. Reload this page in a minute. Reference: ${response.reference}` });
            })
            .finally(() => setBusy(null));
        },
        onClose: () => {
          setBusy(null);
          onRefresh();
        },
      });
      handler.openIframe();
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
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />
      {heading}

      {message && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold ${
            message.kind === "error" ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {card?.status === "active" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            You have <strong>{card.viewsLeft}</strong> of <strong>{card.viewsAllowed}</strong> views left on your scratch card for this term.
          </p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!!busy}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold disabled:opacity-40 cursor-pointer"
          >
            View terminal result
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {card?.status === "exhausted" ? (
            <p className="text-sm text-slate-700">
              All <strong>{card.viewsAllowed}</strong> views on your scratch card for this term have been used. To see this result again you need a new card.
            </p>
          ) : card?.status === "issued" ? (
            <p className="text-sm text-slate-700">The school has issued you a scratch card for this term. Enter its PIN to activate it.</p>
          ) : (
            <p className="text-sm text-slate-700">
              The terminal result is ready. A scratch card ({naira(price)}) lets you view it up to {tr.viewsAllowed ?? 5} times this term, and print it.
            </p>
          )}

          {card?.status === "issued" ? (
            pinBox
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-700">Get a scratch card</p>
                {tr.onlineEnabled && (
                  <button
                    type="button"
                    onClick={payOnline}
                    disabled={!!busy}
                    className="w-full px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-bold disabled:opacity-40 cursor-pointer"
                  >
                    {busy === "pay" ? "Opening payment…" : `Pay ${naira(price)} online`}
                  </button>
                )}
                <p className="text-xs text-slate-500">
                  {tr.onlineEnabled ? "Or buy" : "Buy"} a card from the school office: pay {naira(price)}, collect your PIN, then enter it below.
                </p>
              </div>
              {pinBox}
            </>
          )}
        </div>
      )}

      {confirming && card && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 border border-slate-200 space-y-3">
            <h4 className="font-bold text-slate-900">Use 1 view to open this result?</h4>
            <p className="text-sm text-slate-600">
              You have <strong>{card.viewsLeft}</strong> of {card.viewsAllowed} views left. Opening the result uses 1 view.
            </p>
            <p className="text-xs text-slate-500">
              Printing from the open result is free. If you leave or refresh this page, opening the result again uses another view.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy === "view"} className="px-4 py-2 text-xs font-semibold text-slate-600 cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                onClick={openResult}
                disabled={busy === "view"}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-40 cursor-pointer"
              >
                {busy === "view" ? "Opening…" : "Use 1 view and open"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
