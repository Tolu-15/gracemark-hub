import React from "react";

/**
 * Compact, centered branded loader for a page's first data load. Sits inside the
 * content area (not full-screen) — page chrome (header, filters, tabs) stays visible.
 * Not related to TdevLoader, which is a one-time full-screen splash for app boot.
 */
export function PageLoader({ label = "Loading…", className = "" }: { label?: string; className?: string }) {
  return (
    <div className={`gm-pageloader ${className}`} role="status" aria-live="polite">
      <span className="gm-pageloader__ring" aria-hidden="true" />
      <span className="gm-pageloader__label">{label}</span>
    </div>
  );
}

/** Small inline spinner + label for a refetch — filters changed, data is already on screen. */
export function InlineSpinner({ label = "Updating…", className = "" }: { label?: string; className?: string }) {
  return (
    <span className={`gm-inline-spin ${className}`} role="status" aria-live="polite">
      <span className="gm-inline-spin__ring" aria-hidden="true" />
      {label}
    </span>
  );
}
