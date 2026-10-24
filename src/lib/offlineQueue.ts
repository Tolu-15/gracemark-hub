"use client";

import { getAuthHeaders } from "@/lib/supabase/client";

const QUEUE_KEY = "gm_offline_queue_v1";

/** A fetch() that never reached the server (offline, DNS failure, timeout) — distinct from a
 * response the server actually sent back, which retrying the same request won't fix. */
export function isNetworkFailure(err: unknown): boolean {
  return !navigator.onLine || err instanceof TypeError;
}

export interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  body: string;
  /** Human-readable description shown in the pending-sync banner, e.g. "Attendance — JSS 2, 2026-09-30". */
  label: string;
  queuedAt: string;
}

function readQueue(): QueuedRequest[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedRequest[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* storage full or unavailable (private mode) — the queue just won't survive a reload */
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach((cb) => cb());
}

/** Subscribes to queue length changes (queued, synced, or dropped). Returns an unsubscribe function. */
export function onQueueChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getQueue(): QueuedRequest[] {
  return readQueue();
}

/**
 * A save whose `fetch()` itself threw (offline, DNS failure, timeout — not a
 * server response) gets queued here instead of just failing. Only call this
 * for genuine network failures, never for a response the server actually sent
 * back (a 4xx/5xx means retrying the same request won't help).
 */
export function enqueue(req: { url: string; method: string; body: string; label: string }): void {
  const queue = readQueue();
  queue.push({ ...req, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, queuedAt: new Date().toISOString() });
  writeQueue(queue);
  notify();
}

let flushing = false;

/**
 * Replays queued requests in the order they were saved, using a fresh auth
 * token each time (the one captured when a request was first queued may have
 * expired by the time connectivity returns). Stops at the first request that
 * still fails on the network so order is preserved; a request the server
 * actually responds to (success or rejection) is removed either way, since
 * retrying an already-answered request can't help.
 */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const queue = readQueue();
      if (!queue.length) break;
      const req = queue[0];
      try {
        const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
        const res = await fetch(req.url, { method: req.method, headers, body: req.body });
        writeQueue(readQueue().filter((r) => r.id !== req.id));
        notify();
        if (!res.ok) console.warn(`Offline-queued request was rejected by the server, dropped: ${req.label}`);
      } catch {
        break; // still offline (or the server is unreachable) — stop and retry later
      }
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    flushQueue();
  });
}
