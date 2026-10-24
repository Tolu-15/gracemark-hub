"use client";

import React from "react";
import Link from "next/link";
import { usePendingActions } from "./usePendingActions";

const TERM_LABEL: Record<string, string> = { term1: "1st", term2: "2nd", term3: "3rd" };

/**
 * "Needs your attention" card for the score approval workflow.
 * Admin sees subjects/classes awaiting review; teacher sees subjects/classes
 * sent back for correction. Backed by the same data as the sidebar badge
 * (usePendingActions), so the two can never show different numbers.
 */
export default function PendingActionsFeed({ role }: { role: "admin" | "teacher" }) {
  const { items, loading } = usePendingActions();
  if (loading || !items.length) return null;

  const isAdmin = role === "admin";

  // Admin sees every pending item funnel into the exact same Approvals page
  // regardless of which one they click, so a 48-row list is just 48 copies of
  // the same button. One compact summary card replaces it; the teacher view
  // keeps the per-item list since each row deep-links to a different class/
  // subject in score-entry.
  if (isAdmin) {
    const classCount = new Set(items.map((i) => i.classId)).size;
    const studentCount = items.reduce((sum, i) => sum + i.count, 0);
    const oldest = items.reduce<string | null>((m, i) => (i.oldest && (!m || i.oldest < m) ? i.oldest : m), null);
    const oldestDays = oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 86_400_000)) : 0;
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-rose-900">Scores awaiting review ({items.length})</h3>
          <p className="text-xs text-rose-800 mt-0.5">
            Teachers have submitted these for approval — {studentCount} student record{studentCount === 1 ? "" : "s"} across {classCount}{" "}
            class{classCount === 1 ? "" : "es"}.
            {oldestDays >= 1 && ` The oldest has been waiting ${oldestDays} day${oldestDays === 1 ? "" : "s"}.`}
          </p>
        </div>
        <Link
          href="/admin/approvals"
          className="shrink-0 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold text-center"
        >
          Review All
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 sm:p-5">
      <h3 className="text-sm font-bold text-rose-900">Returned for correction ({items.length})</h3>
      <p className="text-xs text-rose-800 mt-0.5">The admin sent these scores back. Correct them, then click &ldquo;Submit to Admin&rdquo; again.</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={`${item.classId}:${item.subjectId}:${item.term}`}
            className="bg-white border border-rose-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
          >
            <div>
              <div className="text-sm font-bold text-slate-900">
                {item.subjectName} · {item.className}{" "}
                <span className="text-xs font-semibold text-slate-500">
                  ({TERM_LABEL[item.term] || item.term} Term, {item.count} student{item.count === 1 ? "" : "s"})
                </span>
              </div>
              {item.reason && <div className="text-xs text-rose-800 mt-0.5">Admin&rsquo;s message: &ldquo;{item.reason}&rdquo;</div>}
            </div>
            <Link
              href={`/teacher/score-entry?class=${item.classId}&subject=${item.subjectId}&term=${item.term}`}
              className="shrink-0 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold text-center"
            >
              Fix scores
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
