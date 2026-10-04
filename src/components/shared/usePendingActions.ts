"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getAuthHeaders } from "@/lib/supabase/client";
import type { PendingActionItem } from "@/app/api/results/pending-actions/route";

export type { PendingActionItem };

/**
 * Single source of truth for "what needs my attention" in the score
 * approval workflow — feeds both the sidebar badge and the dashboard
 * feed card, so the two never drift out of sync.
 *
 * Admin: subjects/classes with scores awaiting review.
 * Teacher: subjects/classes the admin sent back for correction.
 * Refreshes on navigation and every 2 minutes.
 */
export function usePendingActions(): { count: number; items: PendingActionItem[]; loading: boolean } {
  const [items, setItems] = useState<PendingActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/results/pending-actions", { headers: await getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) setItems(json.items || []);
    } catch {
      /* the badge/feed is a convenience; ignore network errors */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [pathname, load]);

  return { count: items.length, items, loading };
}
