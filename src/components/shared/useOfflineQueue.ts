"use client";

import { useEffect, useState } from "react";
import { getQueue, onQueueChange, flushQueue, QueuedRequest } from "@/lib/offlineQueue";
import { supabase } from "@/lib/supabase/client";

/** Live view of the offline save queue; retries automatically when the browser comes back online. */
export function useOfflineQueue(): QueuedRequest[] {
  const [queue, setQueue] = useState<QueuedRequest[]>([]);

  useEffect(() => {
    let owner: string | undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      owner = session?.user.id;
      setQueue(getQueue(owner));
      if (owner && navigator.onLine) setTimeout(() => void flushQueue(), 0);
    });
    const unsubscribe = onQueueChange(() => setQueue(getQueue(owner)));
    return () => { unsubscribe(); data.subscription.unsubscribe(); };
  }, []);

  return queue;
}
