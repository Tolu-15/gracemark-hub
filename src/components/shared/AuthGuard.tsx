"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { verifyRoleAccess, GuardResult } from "@/lib/guard";
import { UserRole } from "@/types/database";

interface AuthGuardProps {
  requiredRole?: UserRole;
  allowedRoles?: UserRole[] | string[];
  children: React.ReactNode;
}

export default function AuthGuard({ requiredRole, allowedRoles, children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);
  const [authData, setAuthData] = useState<GuardResult | null>(null);

  const effectiveRole = (requiredRole || (allowedRoles && allowedRoles[0]) || "admin") as UserRole;

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

  if (!authorized) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-slate-100">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-slate-700 border-t-amber-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-slate-400">Verifying security session…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
