/** Cancel an initial fetch if React tears down the effect before it starts. */
export function scheduleInitialLoad(load: () => unknown) {
  let cancelled = false;
  queueMicrotask(() => { if (!cancelled) load(); });
  return () => { cancelled = true; };
}
