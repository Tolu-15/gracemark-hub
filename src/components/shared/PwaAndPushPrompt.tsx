"use client";

import React, { useEffect, useRef, useState } from "react";
import { consumeLoginPromptsPending } from "@/lib/loginPrompts";
import { enablePushNotifications, pushSupported } from "@/lib/push";

type PromptKind = "install" | "notify";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
}

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !(window as any).MSStream;
}

/**
 * Mounted once inside the portal shell. Right after a login (flagged via
 * loginPrompts), offers to install the PWA and/or turn on push notifications —
 * whichever the browser still needs. Registers the service worker unconditionally
 * so push and the install prompt both keep working afterwards.
 */
export default function PwaAndPushPrompt() {
  const [queue, setQueue] = useState<PromptKind[]>([]);
  const [busy, setBusy] = useState(false);
  const deferredRef = useRef<any>(null);
  const iosOnlyRef = useRef(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!consumeLoginPromptsPending()) return;

    const wants: PromptKind[] = [];
    if (typeof Notification !== "undefined" && Notification.permission === "default" && pushSupported()) {
      wants.push("notify");
    }

    if (!isStandalone()) {
      if (isIos()) {
        iosOnlyRef.current = true;
        wants.unshift("install");
      } else {
        const onBip = (e: any) => {
          e.preventDefault();
          deferredRef.current = e;
          setQueue((prev) => (prev.includes("install") ? prev : ["install", ...prev]));
        };
        window.addEventListener("beforeinstallprompt", onBip);
        setTimeout(() => window.removeEventListener("beforeinstallprompt", onBip), 20_000);
      }
    }

    if (wants.length) setQueue(wants);
  }, []);

  const active = queue[0];
  if (!active) return null;

  function dismiss() {
    setQueue((prev) => prev.slice(1));
  }

  async function handleInstall() {
    if (deferredRef.current) {
      try {
        deferredRef.current.prompt();
        await deferredRef.current.userChoice;
      } catch {
        /* ignore */
      }
      deferredRef.current = null;
    }
    dismiss();
  }

  async function handleEnableNotifications() {
    setBusy(true);
    try {
      const result = await enablePushNotifications();
      if (!result.ok && result.error) console.warn("Enable notifications failed:", result.error);
    } finally {
      setBusy(false);
      dismiss();
    }
  }

  return (
    <div className="pwa-install-banner is-visible" role="dialog" aria-live="polite">
      <div className="pwa-install-card" style={{ position: "relative" }}>
        <button type="button" className="pwa-install-close" aria-label="Dismiss" onClick={dismiss}>
          &times;
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/icons/icon-192.png" alt="" className="pwa-install-icon" />
        {active === "install" ? (
          <>
            <div className="pwa-install-copy">
              <strong>Install GraceMark Portal</strong>
              {iosOnlyRef.current ? (
                <span>Tap the Share icon, then "Add to Home Screen" for one-tap access.</span>
              ) : (
                <span>Add the portal to your home screen for faster, app-like access.</span>
              )}
            </div>
            <div className="pwa-install-actions">
              {!iosOnlyRef.current && (
                <button type="button" className="pwa-install-btn pwa-install-btn--primary" onClick={handleInstall}>
                  Install
                </button>
              )}
              <button type="button" className="pwa-install-btn pwa-install-btn--ghost" onClick={dismiss}>
                {iosOnlyRef.current ? "Got it" : "Not now"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pwa-install-copy">
              <strong>Turn on notifications</strong>
              <span>Get alerted the moment there's an update for you — no need to keep checking.</span>
            </div>
            <div className="pwa-install-actions">
              <button type="button" className="pwa-install-btn pwa-install-btn--primary" onClick={handleEnableNotifications} disabled={busy}>
                {busy ? "Enabling…" : "Allow"}
              </button>
              <button type="button" className="pwa-install-btn pwa-install-btn--ghost" onClick={dismiss} disabled={busy}>
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
