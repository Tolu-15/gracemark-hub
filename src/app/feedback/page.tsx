"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";

declare global {
  interface Window {
    onFeedbackTurnstileSuccess?: (token: string) => void;
    onFeedbackTurnstileError?: (errorCode: string | number) => boolean;
    turnstile?: { reset: () => void };
  }
}

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

export default function FeedbackPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [feedbackType, setFeedbackType] = useState("suggestion");
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    window.onFeedbackTurnstileSuccess = setToken;
    window.onFeedbackTurnstileError = () => {
      setToken("");
      setError("Human verification could not load. Refresh the page or try a standard browser without an ad blocker.");
      return true;
    };
    return () => {
      delete window.onFeedbackTurnstileSuccess;
      delete window.onFeedbackTurnstileError;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("Please complete the human verification.");
      return;
    }
    setStatus("sending");
    const form = event.currentTarget;
    const website = String(new FormData(form).get("website") || "");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, feedback_type: feedbackType, message, website, turnstile_token: token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send feedback.");
      setStatus("sent");
    } catch (submissionError) {
      setStatus("error");
      setError(submissionError instanceof Error ? submissionError.message : "Unable to send feedback.");
      setToken("");
      window.turnstile?.reset();
    }
  }

  return (
    <main className="min-h-screen bg-white px-4 py-10 text-neutral-900 sm:py-16">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <section className="mx-auto w-full max-w-md">
        <header className="mb-8 text-center">
          <Image src="/assets/icons/logo.jpg" alt="Gracemark Academy" width={76} height={76} className="mx-auto mb-4 rounded-2xl border border-neutral-200" priority />
          <h1 className="text-2xl font-bold tracking-tight">Gracemark Feedback</h1>
          <p className="mt-2 text-sm text-neutral-600">Help us improve the Gracemark portal.</p>
        </header>

        {status === "sent" ? (
          <div className="rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
            <h2 className="text-xl font-bold">Thank you</h2>
            <p className="mt-2 text-sm text-neutral-600">Your feedback has been received by the development team.</p>
            <Link href="/" className="mt-6 inline-block rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white">Back to login</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="space-y-5">
              <label className="block text-sm font-medium">Name <span className="font-normal text-neutral-500">(optional)</span>
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none focus:border-neutral-900" />
              </label>
              <label className="block text-sm font-medium">Email <span className="font-normal text-neutral-500">(optional)</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none focus:border-neutral-900" />
              </label>
              <label className="block text-sm font-medium">Feedback type
                <select value={feedbackType} onChange={(event) => setFeedbackType(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 outline-none focus:border-neutral-900">
                  <option value="suggestion">Suggestion</option><option value="technical_issue">Technical issue</option><option value="general_feedback">General feedback</option>
                </select>
              </label>
              <label className="block text-sm font-medium">Your feedback
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={10} maxLength={3000} required rows={6} placeholder="Tell us what you would like improved or what went wrong." className="mt-1.5 w-full resize-y rounded-lg border border-neutral-300 px-3 py-2.5 outline-none focus:border-neutral-900" />
              </label>
              <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
              {siteKey ? <div className="cf-turnstile" data-sitekey={siteKey} data-callback="onFeedbackTurnstileSuccess" data-error-callback="onFeedbackTurnstileError" /> : <p className="rounded-lg border border-neutral-300 p-3 text-xs text-neutral-600">Feedback verification is being configured. Please return shortly.</p>}
              {error && <p role="alert" className="text-sm text-neutral-800">{error}</p>}
              <button type="submit" disabled={status === "sending" || !siteKey} className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{status === "sending" ? "Sending..." : "Send feedback"}</button>
            </div>
          </form>
        )}
        <footer className="mt-8 text-center text-xs text-neutral-500"><p>Powered by T_dev</p><p className="mt-1">© 2026 Gracemark Academy. All rights reserved.</p></footer>
      </section>
    </main>
  );
}
