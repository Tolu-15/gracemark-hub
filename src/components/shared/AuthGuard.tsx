"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { verifyRoleAccess, GuardResult } from "@/lib/guard";
import { UserRole } from "@/types/database";
import TdevLoader from "./TdevLoader";
import MaintenancePage from "./MaintenancePage";
import { getAuthHeaders } from "@/lib/supabase/client";

const SEEN_KEY = "gm_tdev_intro_seen";
const MIN_MS = 1300;
const FADE_MS = 400;

/** A guard nested inside another (already verified) guard renders straight through. */
const GuardContext = createContext(false);

interface AuthGuardProps {
  requiredRole?: UserRole;
  allowedRoles?: UserRole[] | string[];
  children: React.ReactNode;
}

export default function AuthGuard(props: AuthGuardProps) {
  const nested = useContext(GuardContext);
  return nested ? <>{props.children}</> : <GuardRoot {...props} />;
}

function GuardRoot({ requiredRole, allowedRoles, children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);
  const [authData, setAuthData] = useState<GuardResult | null>(null);
  // First open of the portal in this browser session holds the T_dev screen for a minimum time.
  const [minDone, setMinDone] = useState(false);
  const [loaderGone, setLoaderGone] = useState(false);

  const effectiveRole = (requiredRole || (allowedRoles && allowedRoles[0]) || "admin") as UserRole;

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (seen || reduced) {
      setMinDone(true);
      return;
    }
    const t = setTimeout(() => setMinDone(true), MIN_MS);
    return () => clearTimeout(t);
  }, []);

  // Maintenance mode: re-checked every minute so the page appears (and goes away) without a reload.
  // `bypass` is true for the developer, who still sees the app with a reminder banner.
  const [maintenance, setMaintenance] = useState<{ enabled: boolean; message?: string; backAt?: string | null; bypass: boolean } | null>(null);
  const loadMaintenance = React.useCallback(async () => {
    try {
      const res = await fetch("/api/maintenance", { headers: await getAuthHeaders(), cache: "no-store" });
      if (res.ok) setMaintenance(await res.json());
    } catch {
      /* if the check fails, never lock people out */
    }
  }, []);
  useEffect(() => {
    if (!authorized) return;
    loadMaintenance();
    const t = setInterval(loadMaintenance, 60_000);
    return () => clearInterval(t);
  }, [authorized, loadMaintenance]);
  const blocked = Boolean(maintenance?.enabled && !maintenance.bypass);

  const ready = authorized && minDone;

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setLoaderGone(true), FADE_MS);
    return () => clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    let isMounted = true;

    async function check() {
      const { redirect, result } = await verifyRoleAccess(effectiveRole, pathname || "");
      if (!isMounted) return;

      if (redirect) {
        router.replace(redirect);
      } else if (result) {
        setAuthData(result);
        setAuthorized(true);
      }
    }

    check();

    return () => {
      isMounted = false;
    };
  }, [effectiveRole, pathname, router]);

  return (
    <>
      {authorized && blocked && <MaintenancePage message={maintenance?.message} backAt={maintenance?.backAt} onRetry={loadMaintenance} />}
      {authorized && !blocked && (
        <GuardContext.Provider value={true}>
          {maintenance?.enabled && maintenance.bypass && (
            <div className="print:hidden bg-amber-100 border-b border-amber-300 text-amber-900 text-xs font-semibold text-center px-3 py-1.5">
              Maintenance mode is ON: other users see the &ldquo;under construction&rdquo; page. Only you can see the app. Turn it off in Dev Tools → App Settings.
            </div>
          )}
          {children}
        </GuardContext.Provider>
      )}
      {!loaderGone && <TdevLoader leaving={ready} />}
    </>
  );
}
