"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthHeaders } from "@/lib/supabase/client";
import { useNotificationBadge, badgeText, PortalNotification } from "./useNotificationBadge";
import { enablePushNotifications, getPushState, PushState } from "@/lib/push";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationBell() {
  const { count, refresh } = useNotificationBadge();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PortalNotification[]>([]);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function loadList() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", { headers: await getAuthHeaders() });
      const json = await res.json();
      if (json.ok) setItems(json.notifications || []);
    } catch {
      /* dropdown just stays empty on failure */
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      loadList();
      getPushState().then(setPushState);
    }
  }

  async function handleEnablePush() {
    setPushBusy(true);
    setPushError("");
    try {
      const result = await enablePushNotifications();
      if (result.ok) {
        setPushState("subscribed");
      } else {
        setPushError(result.error || "Could not enable notifications.");
        setPushState(await getPushState());
      }
    } finally {
      setPushBusy(false);
    }
  }

  async function markAllRead() {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ all: true }),
      });
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
      refresh();
    } catch {
      /* ignore */
    }
  }

  async function onItemClick(n: PortalNotification) {
    if (!n.read_at) {
      try {
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
          body: JSON.stringify({ ids: [n.id] }),
        });
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
        refresh();
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  const badge = badgeText(count);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        className="relative p-2 rounded-xl transition cursor-pointer"
        style={{ color: "#475569" }}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {badge && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{ backgroundColor: "#dc2626", color: "#fff" }}
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-xl shadow-2xl border border-slate-200 bg-white z-50 overflow-hidden"
          style={{ maxHeight: "70vh" }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-bold text-slate-800">Notifications</span>
            {count > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer">
                Mark all read
              </button>
            )}
          </div>
          {(pushState === "needs-permission" || pushState === "needs-subscription" || pushState === "denied") && (
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              {pushState === "denied" ? (
                <p className="text-xs text-slate-500">
                  Push notifications are blocked for this site. Allow them in your browser's site settings to get alerts here.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">
                      {pushState === "needs-subscription"
                        ? "Notifications were interrupted — turn them back on."
                        : "Get a push alert the moment there's an update."}
                    </span>
                    <button
                      type="button"
                      onClick={handleEnablePush}
                      disabled={pushBusy}
                      className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg text-white cursor-pointer"
                      style={{ backgroundColor: "#2563eb" }}
                    >
                      {pushBusy ? "Enabling…" : "Turn on"}
                    </button>
                  </div>
                  {pushError && <p className="text-xs text-red-600 mt-1">{pushError}</p>}
                </>
              )}
            </div>
          )}
          <div className="overflow-y-auto" style={{ maxHeight: "calc(70vh - 44px)" }}>
            {loading && <div className="px-4 py-6 text-sm text-slate-400 text-center">Loading…</div>}
            {!loading && items.length === 0 && (
              <div className="px-4 py-6 text-sm text-slate-400 text-center">No notifications yet.</div>
            )}
            {!loading &&
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  className="w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition cursor-pointer flex gap-2"
                >
                  <span
                    className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: n.read_at ? "transparent" : "#2563eb" }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800 truncate">{n.title}</span>
                    <span className="block text-xs text-slate-500 line-clamp-2">{n.body}</span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
