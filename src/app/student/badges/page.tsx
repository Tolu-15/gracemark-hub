"use client";

import React, { useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";
import { PageLoader } from "@/components/shared/PageLoader";

interface Badge {
  id: string;
  badge_type: "position_1" | "position_2" | "position_3";
  level_name: string;
  class_name: string;
  position: number;
  ranked_count: number | null;
  term: string;
  session: string;
  awarded_at: string;
}

const TERM_LABEL: Record<string, string> = { term1: "1st Term", term2: "2nd Term", term3: "3rd Term" };
const MEDAL: Record<string, string> = { position_1: "🥇", position_2: "🥈", position_3: "🥉" };
const BADGE_LABEL: Record<string, string> = { position_1: "1st Position", position_2: "2nd Position", position_3: "3rd Position" };
const BADGE_TONE: Record<string, string> = {
  position_1: "bg-amber-50 border-amber-200",
  position_2: "bg-slate-50 border-slate-300",
  position_3: "bg-orange-50 border-orange-200",
};

export default function StudentBadgesPage() {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/student/badges", { headers: await getAuthHeaders() });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Could not load your badges.");
        setBadges(json.badges || []);
      } catch (err: any) {
        setError(err.message || "Could not load your badges.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="portal-header bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">My Badges</h1>
        <p className="text-xs text-slate-500 mt-0.5">Earned for finishing in the top 3 of your class for a term.</p>
      </header>

      <div className="p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
        {loading ? (
          <div className="min-h-[40vh] flex items-center justify-center">
            <PageLoader label="Loading your badges…" />
          </div>
        ) : error ? (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>
        ) : badges.length === 0 ? (
          <div className="bg-white border border-slate-200/80 rounded-2xl py-16 text-center text-slate-400 text-sm">
            No badges yet — finish in the top 3 of your class to earn one.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {badges.map((b) => (
              <div key={b.id} className={`rounded-2xl border p-4 shadow-xs ${BADGE_TONE[b.badge_type]}`}>
                <div className="flex items-center gap-3">
                  <div className="text-3xl">{MEDAL[b.badge_type]}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">{BADGE_LABEL[b.badge_type]}</div>
                    <div className="text-xs text-slate-600">
                      {b.level_name} · {TERM_LABEL[b.term] || b.term}, {b.session}
                    </div>
                    {b.ranked_count && <div className="text-[11px] text-slate-400 mt-0.5">out of {b.ranked_count} students</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
