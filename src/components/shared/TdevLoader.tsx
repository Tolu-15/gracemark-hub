"use client";

import React from "react";

/**
 * Full-screen "Powered by T_dev" screen. Shown while the portal verifies the session
 * and opens the dashboard. `leaving` fades it out.
 */
export default function TdevLoader({ leaving = false }: { leaving?: boolean }) {
  const letters = ["T", "_", "d", "e", "v"];
  return (
    <div
      className={`tdev-loader ${leaving ? "tdev-loader--out" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="Loading Gracemark portal"
    >
      <div className="tdev-loader__grid" />
      <div className="tdev-loader__aurora tdev-loader__aurora--a" />
      <div className="tdev-loader__aurora tdev-loader__aurora--b" />
      <div className="tdev-loader__scan" />

      <div className="tdev-loader__stage">
        <div className="tdev-loader__ring" />
        <div className="tdev-loader__ring tdev-loader__ring--inner" />
        <div className="tdev-loader__content">
          <span className="tdev-loader__label">Powered by</span>
          <span className="tdev-loader__brand">
            {letters.map((ch, i) => (
              <span key={i} className="tdev-loader__letter" style={{ animationDelay: `${0.15 + i * 0.09}s` }}>
                {ch}
              </span>
            ))}
          </span>
          <span className="tdev-loader__line" />
        </div>
      </div>

      <div className="tdev-loader__status">
        <span className="tdev-loader__bar" />
        <span className="tdev-loader__hint">Securing your session</span>
      </div>
    </div>
  );
}
