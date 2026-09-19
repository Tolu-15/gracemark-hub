"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { fetchUserProfileByAuthId, destinationForRole } from "@/lib/auth";
import PoweredBy from "@/components/shared/PoweredBy";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.replace("/");
          return;
        }
        setCurrentUser(user);

        const profile = await fetchUserProfileByAuthId(user.id);
        if (profile?.role) {
          setRole(profile.role);
        }
      } catch (err) {
        console.error("Change password auth check error:", err);
      } finally {
        setLoading(false);
      }
    }
    checkAuth();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match. Please re-enter your password.");
      return;
    }

    setSubmitting(true);

    try {
      if (!currentUser?.id) throw new Error("No active session found.");

      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          new_password: password,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update password.");
      }

      setSuccess(true);
      setTimeout(() => {
        router.replace(destinationForRole(role || "student"));
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Failed to update password. Please try again.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center text-slate-400 text-sm">
        Checking account status…
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col justify-between bg-[#020617] text-slate-100 relative overflow-x-hidden">
      {/* Decorative Radial Background */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_60%_at_15%_10%,rgba(148,163,184,0.05)_0%,transparent_65%),radial-gradient(ellipse_60%_50%_at_88%_85%,rgba(201,168,76,0.08)_0%,transparent_60%)]" />
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:28px_28px]" />

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 py-10 z-10">
        <div className="card w-full max-w-[440px] bg-[#0f172a]/95 backdrop-blur-md border border-slate-700/60 rounded-3xl shadow-2xl p-6 sm:p-8 relative animate-fade-in">
          {/* Header */}
          <div className="flex justify-center mb-5">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-2xl">
              🛡️
            </div>
          </div>

          <div className="text-center mb-6">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Create Your New Password
            </h1>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Your account requires a new permanent password before proceeding to the portal.
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
              {error}
            </div>
          )}

          {success ? (
            <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
              <div className="text-3xl">🎉</div>
              <h3 className="text-sm font-bold text-emerald-300">Password Updated Successfully!</h3>
              <p className="text-xs text-slate-400">Redirecting to your portal dashboard…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  New Permanent Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter at least 6 characters"
                    className="w-full px-4 py-3 bg-slate-900/80 border border-slate-700/80 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    {showPassword ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Confirm New Password
                </label>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your new password"
                  className="w-full px-4 py-3 bg-slate-900/80 border border-slate-700/80 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 cursor-pointer transition-all disabled:opacity-50"
                >
                  {submitting ? "Securing Account…" : "Set Password & Continue"}
                </button>
              </div>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    router.replace("/");
                  }}
                  className="text-[11px] text-slate-400 hover:text-slate-300 underline cursor-pointer"
                >
                  Sign Out and return to Login
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
