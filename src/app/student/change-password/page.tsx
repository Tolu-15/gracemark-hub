"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import PoweredBy from "@/components/shared/PoweredBy";

export default function StudentChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Session expired. Please log in again.");

      // Verify current password
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signInErr) throw new Error("Current password is incorrect.");

      // Update to new password
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateErr) throw new Error(updateErr.message);

      // Clear must_change_password flag on students table
      await supabase
        .from("students")
        .update({ must_change_password: false })
        .eq("user_id", user.id);

      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "Failed to update password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-black text-slate-900 tracking-tight">Change Password</h2>
        <p className="text-sm text-slate-500 mt-1">
          Update your student portal password. You'll need your current password to confirm.
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-6 sm:p-8">
        {success ? (
          <div className="text-center py-6 space-y-4">
            <div className="text-5xl">🎉</div>
            <h3 className="font-bold text-emerald-700">Password Updated!</h3>
            <p className="text-sm text-slate-500">Your new password is now active.</p>
            <button
              type="button"
              onClick={() => setSuccess(false)}
              className="text-xs text-slate-500 underline cursor-pointer hover:text-slate-700"
            >
              Change again
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 text-sm">
            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                {error}
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Current Password
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? "text" : "password"}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer text-base"
                >
                  {showCurrent ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showNew ? "text" : "password"}
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer text-base"
                >
                  {showNew ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Confirm New Password
              </label>
              <input
                type={showNew ? "text" : "password"}
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className={`w-full px-4 py-2.5 bg-slate-50 border rounded-xl text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white ${
                  confirmPassword && confirmPassword !== newPassword
                    ? "border-rose-300"
                    : "border-slate-300"
                }`}
              />
              {confirmPassword && confirmPassword !== newPassword && (
                <p className="text-[10px] text-rose-500 mt-1">Passwords do not match</p>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer transition-all disabled:opacity-50"
              >
                {submitting ? "Updating Password…" : "Update Password"}
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="text-center"><PoweredBy /></div>
    </div>
  );
}
