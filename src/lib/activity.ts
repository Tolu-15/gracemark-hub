"use client";

import { getAuthHeaders } from "@/lib/supabase/client";

export type ActivityType = "page_view" | "result_view" | "result_print";

const ID_SEGMENT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4,})$/i;

/** Collapses ids in a path so /admin/students/<uuid> and /admin/students/<uuid2> count as one page. */
function normalizePath(path: string): string {
  return path
    .split("?")[0]
    .split("/")
    .map((seg) => (ID_SEGMENT.test(seg) ? ":id" : seg))
    .join("/")
    .slice(0, 200);
}

/** Fire-and-forget usage event. Never throws and never blocks the UI. */
export function trackEvent(type: ActivityType, opts: { path?: string; metadata?: Record<string, string> } = {}): void {
  void (async () => {
    try {
      await fetch("/api/activity", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ type, path: opts.path ? normalizePath(opts.path) : undefined, metadata: opts.metadata }),
      });
    } catch {
      /* analytics must never affect the app */
    }
  })();
}
