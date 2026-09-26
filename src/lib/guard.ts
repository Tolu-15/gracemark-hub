import { PAYMENTS_ENABLED } from "./features";
import { supabase } from "./supabase/client";
import { fetchUserProfileByAuthId, destinationForRole, resolveStudentUserIdCandidates } from "./auth";
import { UserProfile, UserRole } from "@/types/database";

const DEFAULT_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_TIMEOUT_MS, label = "Operation"): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`[Auth Guard] Timeout: ${label}`)), ms);
    }),
  ]);
}

export async function checkSession(timeoutMs = DEFAULT_TIMEOUT_MS) {
  for (let i = 0; i < 3; i++) {
    const { data, error } = await withTimeout(
      supabase.auth.getSession(),
      timeoutMs,
      "getSession()"
    );
    if (error) throw error;
    if (data?.session?.user?.id) return data.session;

    const userResult = await withTimeout(supabase.auth.getUser(), timeoutMs, "getUser()");
    if (!userResult.error && userResult.data?.user?.id && data?.session) {
      return data.session;
    }

    if (i < 2) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return null;
}

export interface GuardResult {
  session: any;
  user: any;
  profile: UserProfile;
  isLocked?: boolean;
}

export function isAllowedFinancialPath(pathname: string): boolean {
  return (
    pathname.includes("/student/school-fees") ||
    pathname.includes("/student/payment-history") ||
    pathname.includes("/student/receipts") ||
    pathname.includes("/student/financial-report") ||
    pathname.includes("/student/locked")
  );
}

export async function verifyRoleAccess(
  requiredRole: UserRole,
  currentPath = ""
): Promise<{ redirect?: string; result?: GuardResult }> {
  try {
    const session = await checkSession();
    if (!session?.user?.id) {
      return { redirect: "/" };
    }

    const profile = await withTimeout(
      fetchUserProfileByAuthId(session.user.id),
      DEFAULT_TIMEOUT_MS,
      "fetchUserProfileByAuthId"
    );

    if (!profile || !profile.role) {
      return { redirect: "/" };
    }

    const role = String(profile.role).trim() as UserRole;
    if (role !== requiredRole) {
      return { redirect: destinationForRole(role) };
    }

    if (role === "student") {
      const candidateIds = await resolveStudentUserIdCandidates(session.user.id);
      const { data: student } = await supabase
        .from("students")
        .select("id, portal_access_status")
        .in("user_id", candidateIds)
        .maybeSingle();

      let isLocked = student?.portal_access_status === "locked";

      if (student?.id && PAYMENTS_ENABLED) {
        try {
          const { evaluateStudentPortalAccess } = await import("./schoolFinance");
          const evalResult = await evaluateStudentPortalAccess(student.id);
          if (evalResult?.isLocked) {
            isLocked = true;
          }
        } catch (evalErr) {
          console.warn("evaluateStudentPortalAccess warning:", evalErr);
        }
      }

      if (isLocked && !isAllowedFinancialPath(currentPath)) {
        return { redirect: "/student/locked" };
      }
      return { result: { session, user: session.user, profile, isLocked } };
    }

    return { result: { session, user: session.user, profile } };
  } catch (error) {
    console.error("[Auth Guard Error]:", error);
    return { redirect: "/" };
  }
}
