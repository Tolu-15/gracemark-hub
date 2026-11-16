"use client";

import { supabase } from "@/lib/supabase/client";

const queueKey = (owner: string) => `gm_offline_queue_v2:${owner}`;

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
  lastError?: string;
}

function readQueue(owner: string): QueuedRequest[] {
  try {
    const raw = localStorage.getItem(queueKey(owner));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(owner: string, queue: QueuedRequest[]) {
  localStorage.setItem(queueKey(owner), JSON.stringify(queue));
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

export function getQueue(owner?: string): QueuedRequest[] {
  return owner ? readQueue(owner) : [];
}

/**
 * A save whose `fetch()` itself threw (offline, DNS failure, timeout — not a
 * server response) gets queued here instead of just failing. Only call this
 * for genuine network failures, never for a response the server actually sent
 * back (a 4xx/5xx means retrying the same request won't help).
 */
export function enqueue(owner: string | undefined, req: { url: string; method: string; body: string; label: string }): void {
  if (!owner) throw new Error("Sign in before saving work offline.");
  const queue = readQueue(owner);
  queue.push({ ...req, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, queuedAt: new Date().toISOString() });
  writeQueue(owner, queue);
  notify();
}

let flushing = false;

/**
 * Replays queued requests in the order they were saved, using a fresh auth
 * token each time (the one captured when a request was first queued may have
 * expired by the time connectivity returns). Stops at the first request that
 * still fails on the network so order is preserved; a request the server
 * rejects a request, keep it on the device so the user can see and recover it.
 */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user.id || !session.access_token) break;
      const owner = session.user.id;
      const queue = readQueue(owner);
      if (!queue.length) break;
      const req = queue[0];
      try {
        const headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
        const res = await fetch(req.url, { method: req.method, headers, body: req.body });
        if (res.status === 401 || res.status === 429 || res.status >= 500) break;
        if (!res.ok) {
          const response = await res.json().catch(() => ({}));
          const error = typeof response.error === "string" ? response.error : `Server rejected the save (${res.status}).`;
          writeQueue(owner, readQueue(owner).map((item) => item.id === req.id ? { ...item, lastError: error } : item));
          notify();
          break;
        }
        writeQueue(owner, readQueue(owner).filter((r) => r.id !== req.id));
        notify();
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
