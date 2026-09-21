"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmail,
  fetchUserProfileByAuthId,
  destinationForRole,
  resolveUserLoginEmail,
  friendlyAuthError,
} from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import PoweredBy from "@/components/shared/PoweredBy";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const rawInput = identifier.trim();
    if (!rawInput || !password) {
      setError("Please enter both your email/admission number and password.");
      return;
    }

    setLoading(true);

    try {
      let targetEmail = await resolveUserLoginEmail(rawInput);
      let signInData: any = null;

      try {
        signInData = await signInWithEmail(targetEmail, password);
      } catch (firstErr) {
        if (!rawInput.includes("@")) {
          const cleanRef = rawInput.replace(/^PAY-/i, "").replace(/\s+/g, "").toUpperCase();
          const clean = cleanRef.replace(/[^A-Z0-9]/gi, "").toLowerCase();
          const candidates = [
            `${clean}@teacher.gracemark.edu.ng`,
            `${clean}@student.gracemark.edu.ng`,
            `${cleanRef.toLowerCase()}@teacher.gracemark.edu.ng`,
            `${cleanRef.toLowerCase()}@student.gracemark.edu.ng`,
          ].filter((email, index, self) => email !== targetEmail && self.indexOf(email) === index);

          let signedIn = false;
          for (const cand of candidates) {
            try {
              signInData = await signInWithEmail(cand, password);
              signedIn = true;
              break;
            } catch {
              // continue to next candidate
            }
          }

          if (!signedIn) {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }

      const user = signInData?.user;
      if (!user?.id) throw new Error("Sign-in succeeded but no user was returned.");

      if (signInData.session) {
        await supabase.auth.setSession(signInData.session);
      }

      let profile = await fetchUserProfileByAuthId(user.id);

      if (!profile?.role) {
        try {
          const syncRes = await fetch("/api/auth/sync-profile", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${signInData.session?.access_token || ""}`,
            },
            body: JSON.stringify({ authId: user.id }),
          });
          if (syncRes.ok) {
            const syncJson = await syncRes.json();
            if (syncJson.ok && syncJson.profile) {
              profile = syncJson.profile;
            }
          }
        } catch (syncErr) {
          console.warn("Self-heal sync profile error:", syncErr);
        }
      }

      if (!profile?.role) {
        setError(
          "Signed in to Supabase Auth, but there is no row in public.users for this account. Please contact the administrator."
        );
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      // Check if user must change password or logged in with a default password
      const DEFAULT_PASSWORDS = new Set([
        "gracemark",
        "gracemark2026!",
        "student123",
        "teacher123",
        "student",
        "password",
        "password123",
        "123456",
        "12345678",
      ]);

      let mustChange = Boolean((profile as any)?.must_change_password);
      const cleanPw = password.trim().toLowerCase();
      if (DEFAULT_PASSWORDS.has(cleanPw) || password.trim().startsWith("Gma@")) {
        mustChange = true;
      }

      if (!mustChange && profile.role === "student") {
        try {
          const { data: std } = await supabase
            .from("students")
            .select("must_change_password")
            .or(`user_id.eq.${user.id},id.eq.${user.id}`)
            .limit(1)
            .maybeSingle();
          if (std?.must_change_password) {
            mustChange = true;
          }
        } catch {
          // fallback
        }
      }

      if (mustChange) {
        router.replace("/change-password");
        return;
      }

      // For admin accounts: check for device cookie — redirect to OTP verify if absent
      if (String(profile.role).trim() === "admin") {
        const deviceCookie = document.cookie
          .split(";")
          .some((c) => c.trim().startsWith("gm_device="));
        if (!deviceCookie) {
          router.replace("/otp-verify");
          return;
        }
      }

      router.replace(destinationForRole(String(profile.role).trim()));
    } catch (err: any) {
      console.error("[Auth Error]", err?.code, err?.message);
      setError(friendlyAuthError(err));
      setLoading(false);
    }
  }

  return (
    <div className="login-page min-h-[100dvh] flex flex-col justify-between bg-[#020617] text-slate-100 relative overflow-x-hidden">
      {/* Decorative Radial Gradients */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_60%_at_15%_10%,rgba(148,163,184,0.05)_0%,transparent_65%),radial-gradient(ellipse_60%_50%_at_88%_85%,rgba(201,168,76,0.08)_0%,transparent_60%)]" />
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:28px_28px]" />

      <main className="flex-1 flex items-center justify-center p-3.5 sm:p-6 py-8 sm:py-12 z-10">
        <div className="card w-full max-w-[420px] bg-[#0f172a]/95 backdrop-blur-md border border-slate-700/60 rounded-2xl sm:rounded-3xl shadow-2xl p-5 sm:p-8 md:p-10 relative animate-fade-in">
          {/* Logo & School Crest */}
          <div className="flex justify-center mb-4 sm:mb-5">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-800/90 p-2 shadow-inner border border-slate-700/70 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/icons/logo.jpg"
                alt="Gracemark Academy Crest"
                className="w-full h-full object-cover rounded-xl"
              />
            </div>
          </div>

          <h1 className="font-serif text-center text-xl sm:text-2xl md:text-3xl font-bold text-slate-100 mb-1 tracking-tight">
            Gracemark Academy
          </h1>
          <p className="text-center text-[11px] sm:text-xs font-semibold uppercase tracking-widest text-[#c9a84c] mb-4">
            Result Hub &amp; Academic Portal
          </p>

          <div className="w-12 h-[3px] bg-gradient-to-r from-[#c9a84c] to-[#e8c97a] rounded-full mx-auto mb-6" />

          {/* Quick Helper Badge */}
          <div className="mb-5 p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/40 text-[11px] text-slate-300 text-center flex items-center justify-center gap-1.5 flex-wrap">
            <span className="text-[#e8c97a] font-semibold">Student:</span> Admission No
            <span className="text-slate-600">•</span>
            <span className="text-blue-400 font-semibold">Staff:</span> Email Address
          </div>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs sm:text-sm flex items-start gap-2.5 leading-relaxed">
              <svg
                className="w-4 h-4 text-red-400 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="flex-1">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
              >
                Email or Admission Number
              </label>
              <input
                id="email"
                type="text"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. GMA202501 or admin@gracemark.sch.ng"
                required
                className="w-full px-3.5 py-2.5 sm:py-3 bg-slate-900/90 border border-slate-700/80 rounded-xl text-slate-100 placeholder-slate-500 text-base sm:text-xs focus:outline-none focus:border-[#c9a84c] focus:ring-1 focus:ring-[#c9a84c] transition"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="••••••••"
                  required
                  className="w-full px-3.5 py-2.5 sm:py-3 bg-slate-900/90 border border-slate-700/80 rounded-xl text-slate-100 placeholder-slate-500 text-base sm:text-xs focus:outline-none focus:border-[#c9a84c] focus:ring-1 focus:ring-[#c9a84c] transition pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition p-1.5 cursor-pointer"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                      />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              id="signInBtn"
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-[#c9a84c] to-[#e8c97a] hover:from-[#d8b75b] hover:to-[#f0d58f] text-slate-950 font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 mt-3 cursor-pointer active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Signing In…</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M14 5l7 7m0 0l-7 7m7-7H3"
                    />
                  </svg>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800/80 text-center text-xs text-slate-400 flex flex-col sm:flex-row items-center justify-center gap-2">
            <span>Prospective student?</span>
            <a
              href="/admission-form"
              className="text-[#c9a84c] hover:text-[#e8c97a] font-semibold underline underline-offset-2"
            >
              Apply for Admission
            </a>
          </div>
        </div>
      </main>

      <PoweredBy />
    </div>
  );
}
