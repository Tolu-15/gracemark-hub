"use client";
import { PaymentResolutions } from "@/components/shared/SchoolFollowUp";

import { useEffect, useState } from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/supabase/client";

export default function ScratchCardPayment() {
  return <Suspense fallback={<p>Checking your payment with Paystack.</p>}><PaymentStatus /></Suspense>;
}

function PaymentStatus() {
  const [message, setMessage] = useState("Checking your payment with Paystack…");
  const [attempt, setAttempt] = useState(0);
  const reference = useSearchParams().get("reference")?.trim() || "";
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    if (!reference) return;
    const controller = new AbortController();

    async function verify() {
      try {
        const response = await fetch("/api/student/scratch-card/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
          body: JSON.stringify({ reference }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (response.ok && result.ok) {
          setMessage(result.status === "duplicate"
            ? "Payment received. You already have a card for this term. Give the school the reference below for a refund or credit."
            : "Payment confirmed. You can now view and print your terminal result.");
        } else {
          setMessage(result.error || "Payment is still unconfirmed. If you paid, check again before starting another checkout.");
          setCanRetry(true);
        }
      } catch {
        if (controller.signal.aborted) return;
        setMessage("We couldn't reach the payment service. Check your connection and try again. If you were charged, keep the reference below.");
        setCanRetry(true);
      }
    }
    void verify();
    return () => controller.abort();
  }, [attempt, reference]);

  function checkAgain() {
    setCanRetry(false);
    setMessage("Checking your payment with Paystack…");
    setAttempt(value => value + 1);
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-bold text-slate-900">Scratch card payment</h1>
      <p role="status" className="text-sm text-slate-700">{reference ? message : "Open your results and select the term you paid for to find your last checkout."}</p>
      {reference && (
        <div>
          <p className="text-xs font-semibold text-slate-600">Payment reference</p>
          <p className="select-all break-all font-mono text-sm">{reference}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4">
        {canRetry && (
          <button type="button" onClick={checkAgain} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Check again
          </button>
        )}
        <Link className="text-sm font-semibold underline" href="/student/result">Go to my results</Link>
      </div>
      <PaymentResolutions />
    </main>
  );
}
