import { supabase } from "/js/shared/supabaseClient.js";
import { fetchUserProfileByAuthId, destinationForRole } from "/js/shared/auth.js";

const DEFAULT_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, label) {
  const timeoutMs = Number.isFinite(ms) ? ms : DEFAULT_TIMEOUT_MS;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`[Auth Guard] Timeout: ${label}`)), timeoutMs);
    }),
  ]);
}

async function loadAuthSession(timeoutMs) {
  // Retry: session may not be written to storage immediately after sign-in redirect.
  const attempts = 4;
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await withTimeout(supabase.auth.getSession(), timeoutMs, "getSession()");
    if (error) throw error;
    if (data?.session?.user?.id) return data.session;

    const userResult = await withTimeout(supabase.auth.getUser(), timeoutMs, "getUser()");
    if (!userResult.error && userResult.data?.user?.id && data?.session) {
      return data.session;
    }

    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  return null;
}

export async function requireAuth({ redirectTo = "/", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const session = await loadAuthSession(timeoutMs);
  if (!session) {
    console.warn("[Auth Guard] No valid session found. Redirecting to login...");
    if (redirectTo) window.location.replace(redirectTo);
    return null;
  }

  return { session, user: session.user };
}

export async function requireRole(
  requiredRole,
  { redirectTo = "/", timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const auth = await requireAuth({ redirectTo, timeoutMs });
  if (!auth?.user?.id) return null;

  const profile = await withTimeout(
    fetchUserProfileByAuthId(auth.user.id),
    timeoutMs,
    "fetchUserProfileByAuthId()"
  );
  if (!profile || !profile.role) {
    console.warn("[Auth Guard] User profile or role missing in database.", {
      authId: auth.user.id,
      profile,
    });
    if (redirectTo) window.location.replace(redirectTo);
    return null;
  }

  const role = String(profile.role).trim();
  if (role !== requiredRole) {
    window.location.replace(destinationForRole(role));
    return null;
  }

  // Check portal lock status for student role
  if (role === "student") {
    try {
      const path = window.location.pathname;
      const isAllowedFinancialPage = path.includes("/student/school-fees") ||
        path.includes("/student/payment-history") ||
        path.includes("/student/receipts") ||
        path.includes("/student/financial-report") ||
        path.includes("/student/locked");

      if (!isAllowedFinancialPage) {
        const { data: student } = await supabase
          .from("students")
          .select("portal_access_status")
          .eq("user_id", auth.user.id)
          .maybeSingle();

        if (student?.portal_access_status === "LOCKED") {
          window.location.replace("/student/locked/");
          return null;
        }
      }
    } catch (lockErr) {
      console.warn("Guard lock status check:", lockErr);
    }
  }

  return { session: auth.session, user: auth.user, profile };
}
