"use client";

import { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";
import type { Period, Slot } from "./TimetableGrid";

export interface TimetableData {
  session: string;
  term: string;
  periods: Period[];
  slots: Slot[];
}

/** Loads a timetable from /api/timetable with the given query string; reloads when it changes. */
export function useTimetable(query: string | null) {
  const [data, setData] = useState<TimetableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (query === null) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/timetable?${query}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load the timetable.");
      setData({ session: json.session, term: json.term, periods: json.periods, slots: json.slots });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
