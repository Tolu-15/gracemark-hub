"use client";

import React from "react";
import { useOfflineQueue } from "./useOfflineQueue";

/** Shows how many saves are waiting to sync while offline. Renders nothing when the queue is empty. */
export default function OfflineQueueBanner() {
  const queue = useOfflineQueue();
  if (!queue.length) return null;

  return (
    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
      <span>
        {queue.length} change{queue.length === 1 ? "" : "s"} saved offline — will sync automatically once you're back online.
      </span>
    </div>
  );
}
