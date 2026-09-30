"use client";

import React from "react";

/**
 * Full-screen launch splash shown while the portal verifies the session and opens
 * the dashboard. Uses the same look as #gm-splash (the installed-app splash painted
 * before any JS runs) so the two never look like separate loading screens — in
 * standalone/installed mode this one picks up right where that one leaves off.
 * `leaving` fades it out.
 */
export default function TdevLoader({ leaving = false }: { leaving?: boolean }) {
  return (
    <div
      className={`gm-launch-splash ${leaving ? "gm-splash--out" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="Loading Gracemark portal"
    >
      <div className="gm-splash__mark">
        <span className="gm-splash__ring" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/icons/logo.jpg" alt="" />
      </div>
      <span className="gm-splash__name">GraceMark Academy</span>
      <span className="gm-splash__bar" />
    </div>
  );
}
