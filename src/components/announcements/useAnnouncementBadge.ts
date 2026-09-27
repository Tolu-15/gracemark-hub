"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getAuthHeaders } from "@/lib/supabase/client";

/** Unread announcement count for the signed-in user; refreshes on navigation and every 2 minutes. */
export function useAnnouncementBadge(): number {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/announcements?summary=1", { headers: await getAuthHeaders() });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.ok) setCount(json.unreadCount || 0);
      } catch {
        /* the badge is a convenience; ignore network errors */
      }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pathname]);

  return count;
}

/** "3", or "9+" — undefined when there is nothing unread so no badge renders. */
export const badgeText = (n: number): string | undefined => (n > 0 ? (n > 9 ? "9+" : String(n)) : undefined);
