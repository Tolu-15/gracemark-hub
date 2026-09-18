"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  signInWithEmail,
  resolveUserLoginEmail,
  fetchUserProfileByAuthId,
  destinationForRole,
} from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [btnText, setBtnText] = useState("Sign In");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    // Clear stale session if expired
    async function checkStale() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error && /invalid|expired|jwt/i.test(error.message || "")) {
          await supabase.auth.signOut();
        }
      } catch (_) {}
    }
    checkStale();
  }, []);

  function friendlyAuthError(error: any) {
    const message = String(error?.message || "");
    const code = String(error?.code || "");

    if (/email not confirmed/i.test(message)) {
      return "Email not confirmed. In Supabase go to Auth → Users, open your user, and confirm email.";
    }
    if (/invalid login credentials|invalid_credentials/i.test(message + code)) {
      return "Invalid credentials. Please check your email or admission number and password.";
    }
    if (/invalid api key|jwt/i.test(message)) {
      return "Supabase API key mismatch. Please check your environment variables.";
    }
    if (/failed to fetch|network/i.test(message)) {
      return "Cannot connect to server. Please check your internet connection.";
    }

    const map: Record<string, string> = {
      "auth/invalid-credentials": "Invalid email or password. Please try again.",
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/too-many-requests": "Too many failed attempts. Please wait a moment and try again.",
    };
    return map[code] || message || "Something went wrong. Please try again.";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");

    const rawInput = identifier.trim();
    const pwd = password;

    if (!rawInput || !pwd) {
      setErrorMsg("Please enter both your email/admission number and password.");
      return;
    }

    setLoading(true);
    setBtnText("Signing in…");

    try {
      let targetEmail = await resolveUserLoginEmail(rawInput);
      let signInData: any = null;

      try {
        signInData = await signInWithEmail(targetEmail, pwd);
      } catch (firstErr) {
        if (!rawInput.includes("@")) {
          const cleanRef = rawInput.replace(/^PAY-/i, "").replace(/\s+/g, "").toUpperCase();
          const altSynthetic = `${cleanRef.replace(/[^A-Z0-9]/gi, "").toLowerCase()}@student.gracemark.edu.ng`;
          if (altSynthetic !== targetEmail) {
            signInData = await signInWithEmail(altSynthetic, pwd);
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }

      const user = signInData?.user;
      if (!user?.id) throw new Error("Sign-in succeeded but no user was returned.");

      const profile = await fetchUserProfileByAuthId(user.id);
      if (!profile?.role) {
        setErrorMsg(
          "Signed in successfully, but no user role was found in public.users for this account. Please contact school administration."
        );
        await supabase.auth.signOut();
        setLoading(false);
        setBtnText("Sign In");
        return;
      }

      setBtnText("Redirecting…");
      const targetUrl = destinationForRole(String(profile.role).trim());
      router.push(targetUrl);
    } catch (err: any) {
      console.error("[Auth Error]", err);
      setErrorMsg(friendlyAuthError(err));
      setLoading(false);
      setBtnText("Sign In");
    }
  }

  return (
    <div className="relative min-h-[100dvh] flex flex-col justify-between items-center bg-[#020617] text-[#f1f5f9] p-4 sm:p-6 overflow-x-hidden">
      {/* Background radial gradients & grid texture */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 15% 10%, rgba(148, 163, 184, .05) 0%, transparent 65%), radial-gradient(ellipse 60% 50% at 88% 85%, rgba(201, 168, 76, .08) 0%, transparent 60%)",
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(148, 163, 184, .08) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="w-full flex-1 flex items-center justify-center relative z-10 py-8">
        <div className="w-full max-w-[440px] bg-[#0f172a] border border-[#94a3b8]/15 rounded-[20px] shadow-2xl p-8 sm:p-12 relative animate-fade-in">
          {/* Logo & School Crest */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-16 h-16 rounded-2xl overflow-hidden ring-2 ring-[#c9a84c]/60 shadow-lg mb-4 bg-slate-900 flex items-center justify-center">
              <img
                src="/assets/icons/logo.jpg"
                alt="Gracemark Academy Logo"
                className="w-full h-full object-cover"
              />
            </div>
            <h1 className="text-xl sm:text-2xl font-serif font-bold tracking-tight text-white mb-1">
              GRACEMARK ACADEMY
            </h1>
            <div className="w-12 h-1 bg-gradient-to-r from-[#c9a84c] to-[#e8c97a] rounded-full mx-auto my-2" />
            <p className="text-xs sm:text-sm font-medium text-slate-400 tracking-wide uppercase">
              Result Hub & Portal Access
            </p>
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <div
              id="errorAlert"
              role="alert"
              className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs sm:text-sm flex items-start gap-2.5 animate-shake"
            >
              <svg
                className="w-4 h-4 shrink-0 mt-0.5 text-rose-400"
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
              <span className="flex-1">{errorMsg}</span>
            </div>
          )}

          {/* Login Form */}
          <form id="loginForm" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Email or Admission Number
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (errorMsg) setErrorMsg("");
                  }}
                  placeholder="e.g. GM/2024/001 or email@example.com"
                  className="w-full px-4 py-3 bg-slate-900/90 border border-slate-700/80 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#c9a84c] focus:border-transparent transition-all"
                  autoComplete="username"
                  autoCapitalize="none"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-slate-300 uppercase tracking-wider"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-xs text-slate-400 hover:text-[#e8c97a] transition-colors focus:outline-none"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMsg) setErrorMsg("");
                  }}
                  placeholder="Enter your password"
                  className="w-full px-4 py-3 bg-slate-900/90 border border-slate-700/80 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#c9a84c] focus:border-transparent transition-all"
                  autoComplete="current-password"
                />
              </div>
            </div>

            <button
              id="signInBtn"
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3.5 px-4 bg-gradient-to-r from-[#c9a84c] to-[#e8c97a] hover:from-[#d8b75b] hover:to-[#f0d48c] text-slate-950 font-bold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading && (
                <svg
                  className="animate-spin h-4 w-4 text-slate-950"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
              )}
              <span>{btnText}</span>
              {!loading && (
                <svg
                  className="w-4 h-4 text-slate-950"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    d="M14 5l7 7m0 0l-7 7m7-7H3"
                  />
                </svg>
              )}
            </button>
          </form>

          {/* Help links */}
          <div className="mt-8 pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-3">
            <Link
              href="/admission-form"
              className="text-[#e8c97a] hover:underline font-medium"
            >
              New Student? Apply Online
            </Link>
            <span className="text-slate-500">Forgot Password? Contact Admin</span>
          </div>
        </div>
      </div>

      {/* Footer Branding */}
      <footer className="w-full text-center py-4 text-xs text-slate-500 relative z-10">
        &copy; {new Date().getFullYear()} Gracemark Academy. All rights reserved.
      </footer>
    </div>
  );
}
