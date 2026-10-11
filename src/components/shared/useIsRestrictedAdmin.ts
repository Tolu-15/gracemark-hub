"use client";

import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";

/** Whether the signed-in admin is a view-only account (the is_restricted_admin flag on their users row). */
export function useIsRestrictedAdmin(): boolean {
  const [restricted, setRestricted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/restricted-check", { headers: await getAuthHeaders() });
        if (!res.ok) return;
        const json = await res.json();
        if (json.ok) setRestricted(Boolean(json.restricted));
      } catch {
        /* nav just stays full on failure */
      }
    })();
  }, []);

  return restricted;
}
