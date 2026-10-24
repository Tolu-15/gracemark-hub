"use client";

import { useEffect, useState } from "react";
import { getQueue, onQueueChange, flushQueue, QueuedRequest } from "@/lib/offlineQueue";

/** Live view of the offline save queue; retries automatically when the browser comes back online. */
export function useOfflineQueue(): QueuedRequest[] {
  const [queue, setQueue] = useState<QueuedRequest[]>([]);

  useEffect(() => {
    setQueue(getQueue());
    const unsubscribe = onQueueChange(() => setQueue(getQueue()));
    if (navigator.onLine) flushQueue();
    return unsubscribe;
  }, []);

  return queue;
}
