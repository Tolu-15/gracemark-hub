"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getAuthHeaders } from "@/lib/supabase/client";

export interface PortalNotification {
  id: string;
  created_at: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  actor_role: string | null;
}

/** Unread notification count for the signed-in user; refreshes on navigation and every 45s. */
export function useNotificationBadge() {
  const [count, setCount] = useState(0);
  const [bump, setBump] = useState(0);
  const pathname = usePathname();

  const refresh = useCallback(() => setBump((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/notifications?summary=1", { headers: await getAuthHeaders() });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.ok) setCount(json.unreadCount || 0);
      } catch {
        /* the badge is a convenience; ignore network errors */
      }
    };
    load();
    const t = setInterval(load, 45_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pathname, bump]);

  return { count, refresh };
}

export const badgeText = (n: number): string | undefined => (n > 0 ? (n > 9 ? "9+" : String(n)) : undefined);
