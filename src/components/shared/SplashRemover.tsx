"use client";

import { useEffect } from "react";

/** Fades out the server-rendered installed-app splash (#gm-splash) once React has hydrated. */
export default function SplashRemover() {
  useEffect(() => {
    const el = document.getElementById("gm-splash");
    if (!el) return;
    const raf = requestAnimationFrame(() => el.classList.add("gm-splash--out"));
    const t = setTimeout(() => el.remove(), 500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, []);
  return null;
}
