"use client";

import { useEffect, useState } from "react";

/** Fades out the server-rendered installed-app splash (#gm-splash) once React has hydrated. */
export default function SplashRemover() {
  const [phase, setPhase] = useState<"visible" | "fading" | "hidden">("visible");
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase("fading"));
    const t = setTimeout(() => setPhase("hidden"), 500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, []);
  if (phase === "hidden") return null;
  return (
    <div id="gm-splash" className={phase === "fading" ? "gm-splash--out" : undefined} aria-hidden="true">
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
