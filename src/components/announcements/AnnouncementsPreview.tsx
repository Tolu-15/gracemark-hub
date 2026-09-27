"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/supabase/client";

interface Item {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  unread: boolean;
  created_at: string;
  author_name: string | null;
  classes?: { name: string } | null;
}

const AUTO_ADVANCE_MS = 6000;

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Carousel of the latest 5 announcements for the dashboard. Renders nothing when there are none. */
export default function AnnouncementsPreview({ role }: { role: "admin" | "teacher" | "student" }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/announcements", { headers: await getAuthHeaders() });
        const json = await res.json();
        if (cancelled || !json.ok) return;
        setItems((json.announcements as Item[]).filter((a: any) => !a.expired).slice(0, 5));
        setUnread(json.unreadCount || 0);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const count = items?.length || 0;
  useEffect(() => {
    if (paused || count < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), AUTO_ADVANCE_MS);
    return () => clearInterval(t);
  }, [paused, count]);

  // Keep the index valid if the list shrinks (e.g. re-fetch).
  const safeIndex = useMemo(() => (count ? index % count : 0), [index, count]);

  if (!items || items.length === 0) return null;

  const goTo = (i: number) => setIndex(((i % count) + count) % count);

  return (
    <section
      className="gm-reveal mb-6 rounded-xl border border-slate-200 bg-white shadow-sm"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">Announcements</h2>
          {unread > 0 && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white">{unread} new</span>}
        </div>
        <Link href={`/${role}/announcements`} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">
          View all
        </Link>
      </div>

      <div className="relative overflow-hidden">
        <div className="flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${safeIndex * 100}%)` }}>
          {items.map((a) => (
            <Link
              key={a.id}
              href={`/${role}/announcements`}
              className="block w-full shrink-0 px-5 py-4 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2">
                {a.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" aria-label="New" />}
                {a.pinned && <span className="text-[10px] font-bold uppercase text-amber-700">Pinned</span>}
                <span className="truncate text-sm font-semibold text-slate-900">{a.title}</span>
                {a.classes?.name && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{a.classes.name}</span>}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{a.body}</p>
              <div className="mt-1.5 text-[11px] text-slate-400">
                {a.author_name ? `${a.author_name} · ` : ""}
                {timeAgo(a.created_at)}
              </div>
            </Link>
          ))}
        </div>

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => goTo(safeIndex - 1)}
              aria-label="Previous announcement"
              className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white/90 p-1 text-slate-500 shadow-sm hover:bg-white hover:text-slate-800 cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => goTo(safeIndex + 1)}
              aria-label="Next announcement"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white/90 p-1 text-slate-500 shadow-sm hover:bg-white hover:text-slate-800 cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex items-center justify-center gap-1.5 border-t border-slate-100 py-2">
          {items.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show announcement ${i + 1}`}
              className={`h-1.5 rounded-full transition-all cursor-pointer ${i === safeIndex ? "w-4 bg-indigo-600" : "w-1.5 bg-slate-200 hover:bg-slate-300"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
