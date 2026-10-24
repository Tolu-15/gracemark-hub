"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getAuthHeaders } from "@/lib/supabase/client";

/** Count of submitted scores awaiting admin review this term; refreshes on navigation and every 2 minutes. */
export function usePendingApprovalsBadge(): number {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/results/status-summary", { headers: await getAuthHeaders() });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.ok) setCount(json.counts?.submitted || 0);
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
