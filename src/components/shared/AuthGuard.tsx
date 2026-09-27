"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { verifyRoleAccess, GuardResult } from "@/lib/guard";
import { UserRole } from "@/types/database";
import TdevLoader from "./TdevLoader";

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
      {authorized && <GuardContext.Provider value={true}>{children}</GuardContext.Provider>}
      {!loaderGone && <TdevLoader leaving={ready} />}
    </>
  );
}
