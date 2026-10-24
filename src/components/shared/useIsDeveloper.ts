"use client";

import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";

/** Whether the signed-in admin has Dev Tools access (the is_developer flag on their users row). */
export function useIsDeveloper(): boolean {
  const [isDeveloper, setIsDeveloper] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/dev-tools/check", { headers: await getAuthHeaders() });
        if (!res.ok) return;
        const json = await res.json();
        if (json.ok) setIsDeveloper(Boolean(json.isDeveloper));
      } catch {
        /* nav item just stays hidden on failure */
      }
    })();
  }, []);

  return isDeveloper;
}
