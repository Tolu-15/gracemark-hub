"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import Link from "next/link";
import PoweredBy from "@/components/shared/PoweredBy";

interface TeacherProfile {
  display_name: string;
  email: string;
  personal_email: string;
  phone: string;
  staff_id: string;
  role: string;
}

export default function TeacherProfilePage() {
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [personalEmail, setPersonalEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("users")
        .select("display_name, email, personal_email, phone, staff_id, role")
        .eq("auth_id", user.id)
        .maybeSingle();

      if (data) {
        setProfile(data);
        setPersonalEmail(data.personal_email || "");
        setPhone(data.phone || "");
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);

    // Basic email validation
    if (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
      setError("Please enter a valid recovery email address.");
      return;
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      const res = await fetch("/api/teacher/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ personal_email: personalEmail, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save.");
      setSaved(true);
      // Update local state
      setProfile((p) => p ? { ...p, personal_email: personalEmail, phone } : p);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto text-center py-12 text-slate-400 text-sm">
        Loading profile…
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-black text-slate-900 tracking-tight">My Profile</h2>
        <p className="text-sm text-slate-500 mt-1">
          Manage your contact details and recovery email.
        </p>
      </div>

      {/* Account Info (read-only) */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-6">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">
          Account Information
        </h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-slate-500 font-medium">Name</span>
            <span className="font-bold text-slate-900">{profile?.display_name || "—"}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-slate-500 font-medium">Login Email</span>
            <span className="font-mono text-xs text-slate-700">{profile?.email || "—"}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-slate-500 font-medium">Staff ID</span>
            <span className="font-mono text-xs text-slate-700">{profile?.staff_id || "—"}</span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-slate-500 font-medium">Role</span>
            <span className="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
              {profile?.role || "teacher"}
            </span>
          </div>
        </div>
      </div>

      {/* Editable fields */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-6">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">
          Contact & Recovery Details
        </h3>

        <form onSubmit={handleSave} className="space-y-5 text-sm">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {error}
            </div>
          )}
          {saved && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
              ✅ Profile saved successfully!
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Recovery / Personal Email
            </label>
            <input
              type="email"
              value={personalEmail}
              onChange={(e) => setPersonalEmail(e.target.value)}
              placeholder="e.g. yourname@gmail.com"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Used for account recovery and important notifications. Not your login email.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 08012345678"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
            />
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer transition-all disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <Link
              href="/teacher/change-password"
              className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer transition-all text-center"
            >
              Change Password
            </Link>
          </div>
        </form>
      </div>

      <div className="text-center"><PoweredBy /></div>
    </div>
  );
}
