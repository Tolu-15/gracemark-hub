"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import PoweredBy from "@/components/shared/PoweredBy";

export default function OtpVerifyPage() {
  const router = useRouter();
  const [authId, setAuthId] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/");
        return;
      }
      setAuthId(user.id);
      setLoading(false);
      // Auto-send OTP on mount
      await requestOtp(user.id);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function requestOtp(id: string) {
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_id: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send code.");
      setEmailHint(data.email_hint || "");
      setCountdown(60);
    } catch (err: any) {
      setError(err.message || "Failed to send verification code.");
    } finally {
      setSending(false);
    }
  }

  function handleOtpChange(index: number, value: string) {
    const clean = value.replace(/\D/g, "").slice(0, 1);
    const next = [...otp];
    next[index] = clean;
    setOtp(next);
    if (clean && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(""));
      inputRefs.current[5]?.focus();
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length < 6) {
      setError("Please enter all 6 digits.");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_id: authId, otp: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code.");
      setSuccess(true);
      setTimeout(() => router.replace("/admin/dashboard"), 1200);
    } catch (err: any) {
      setError(err.message || "Verification failed.");
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center text-slate-400 text-sm">
        Securing your session…
      </div>
    );
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col justify-between relative overflow-x-hidden"
      style={{
        backgroundImage: "url('/assets/images/login-bg.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      {/* Dark overlay */}
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: "rgba(7,17,32,0.72)" }} />

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 py-10 z-10">
        <div className="w-full max-w-[420px] rounded-3xl shadow-2xl p-6 sm:p-8 relative" style={{ backgroundColor: "#ffffff", border: "1px solid rgba(7,17,32,0.12)", boxShadow: "0 32px 80px rgba(7,17,32,0.6)" }}>

          <div className="flex justify-center mb-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "rgba(7,17,32,0.08)", border: "1px solid rgba(7,17,32,0.15)" }}>
              <svg className="w-8 h-8" fill="none" stroke="#071120" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
            </div>
          </div>

          <div className="text-center mb-6">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: "#071120" }}>
              New Device Detected
            </h1>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              A 6-digit verification code was sent to{" "}
              <span className="font-semibold" style={{ color: "#c9a84c" }}>{emailHint || "your admin email"}</span>.
              <br />Enter it below to continue.
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium text-center">
              {error}
            </div>
          )}

          {success ? (
            <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
              </div>
              <h3 className="text-sm font-bold text-emerald-300">Device Verified!</h3>
              <p className="text-xs text-slate-400">Redirecting to your dashboard…</p>
            </div>
          ) : (
            <form onSubmit={handleVerify} className="space-y-6">
              {/* OTP Input Grid */}
              <div className="flex gap-2 justify-center" onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    id={`otp-digit-${i}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-black rounded-xl transition-all"
                    style={{ height: "3.25rem", backgroundColor: "#f8fafc", border: "1.5px solid #cbd5e1", color: "#071120", outline: "none" }}
                    autoComplete="one-time-code"
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={verifying || otp.join("").length < 6}
                className="w-full py-3 rounded-xl text-xs uppercase tracking-wider cursor-pointer transition-all disabled:opacity-50 font-black"
                style={{ backgroundColor: "#071120", color: "#ffffff", boxShadow: "0 4px 14px rgba(7,17,32,0.4)" }}
              >
                {verifying ? "Verifying…" : "Verify & Continue →"}
              </button>

              {/* Resend */}
              <div className="text-center">
                {countdown > 0 ? (
                  <p className="text-xs text-slate-500">
                    Resend code in <span className="text-amber-400 font-semibold">{countdown}s</span>
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => authId && requestOtp(authId)}
                    className="text-xs text-amber-400 hover:text-amber-300 underline cursor-pointer disabled:opacity-50"
                  >
                    {sending ? "Sending…" : "Resend verification code"}
                  </button>
                )}
              </div>

              {/* Sign out */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    router.replace("/");
                  }}
                  className="text-[11px] text-slate-500 hover:text-slate-400 underline cursor-pointer"
                >
                  Sign out and return to Login
                </button>
              </div>
            </form>
          )}
        </div>
      </main>

      <footer className="py-4 text-center text-xs text-slate-500 relative z-10">
        <PoweredBy />
      </footer>
    </div>
  );
}
