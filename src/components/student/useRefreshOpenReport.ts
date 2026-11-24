import { useEffect } from "react";

export function useRefreshOpenReport(open: boolean, reload: () => Promise<void>) {
  useEffect(() => {
    if (!open) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void reload();
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.clearInterval(timer);
    };
  }, [open, reload]);
}
