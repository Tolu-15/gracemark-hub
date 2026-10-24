"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Props {
  message?: string;
  backAt?: string | null;
  onRetry: () => void;
}

/** Full-screen "under construction" page shown to everyone but the developer while maintenance is on. */
export default function MaintenancePage({ message, backAt, onRetry }: Props) {
  const router = useRouter();

  async function signOut() {
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } finally {
      router.replace("/");
    }
  }

  const back = backAt
    ? new Date(backAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full text-center bg-white border border-slate-200 rounded-3xl shadow-sm p-8 space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-2xl" aria-hidden>
          🚧
        </div>
        <h1 className="text-xl font-bold text-slate-900">We&rsquo;re making improvements</h1>
        <p className="text-sm text-slate-600">
          {message || "The Gracemark portal is undergoing maintenance. Please check back shortly."}
        </p>
        {back && (
          <p className="text-xs font-semibold text-slate-500">
            Expected back: <span className="text-slate-800">{back}</span>
          </p>
        )}
        <div className="flex items-center justify-center gap-2 pt-2">
          <button type="button" onClick={onRetry} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold cursor-pointer">
            Check again
          </button>
          <button type="button" onClick={signOut} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-bold cursor-pointer">
            Sign out
          </button>
        </div>
        <p className="text-[11px] text-slate-400">Your results and records are safe.</p>
      </div>
    </div>
  );
}
