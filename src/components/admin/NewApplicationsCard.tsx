"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/supabase/client";

/** Dashboard card: appears when paid admission applications are waiting for the school to look at them. */
export default function NewApplicationsCard() {
  const [count, setCount] = useState(0);
  const [approved, setApproved] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/admissions", { headers: await getAuthHeaders() });
        const json = await res.json();
        if (!cancelled && json.ok) {
          setCount(json.counts?.submitted || 0);
          setApproved(json.counts?.approved || 0);
        }
      } catch {
        /* the card just stays hidden on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!count && !approved) return null;
  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-bold text-indigo-900">
          {count > 0 ? `${count} new admission application${count === 1 ? "" : "s"}` : "Admission applications to enrol"}
        </h3>
        <p className="text-xs text-indigo-800 mt-0.5">
          {count > 0 ? "Paid and waiting for review." : ""}
          {count > 0 && approved > 0 ? " " : ""}
          {approved > 0 ? `${approved} approved and ready to enrol.` : ""}
        </p>
      </div>
      <Link href="/admin/admissions/applicants" className="shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold text-center">
        Open applicants
      </Link>
    </div>
  );
}
