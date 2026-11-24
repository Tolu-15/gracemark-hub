import { TRUST_COOKIE, trustsDevice } from "./otp";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getMaintenance } from "@/lib/systemSettings";

export type ApiRole = "admin" | "teacher" | "student";

export interface ApiActor {
  authId: string;
  dbUserId?: string;
  restricted?: boolean;
  email?: string;
  role: ApiRole;
  service: NonNullable<ReturnType<typeof getServiceClient>>;
}

/**
 * Validates the Supabase access token before a route uses the service-role
 * client. Service-role queries bypass RLS, so every such route needs an
 * explicit server-side authorization check.
 */
const restrictedReadPaths = new Set([
  "/api/admin/restricted-check", "/api/admin/settings", "/api/admin/historical-lookup",
  "/api/admin/class-broadsheet", "/api/admin/leaderboard", "/api/admin/reports/bulk",
  "/api/admin/results/status-summary", "/api/student/report", "/api/results/pending-actions",
  "/api/announcements", "/api/notifications", "/api/terms"
]);

export async function requireApiActor(
  req: NextRequest,
  allowedRoles: ApiRole[],
  options: { allowLockedStudent?: boolean; allowOwnPasswordChange?: boolean; adminChallenge?: boolean } = {}
): Promise<{ actor: ApiActor } | { response: NextResponse }> {
  const service = getServiceClient();
  if (!service) {
    return {
      response: NextResponse.json({ error: "Server service role not configured." }, { status: 503 }),
    };
  }

  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }

  const { data: userData, error: userError } = await service.auth.getUser(token);
  if (userError || !userData.user?.id) {
    return { response: NextResponse.json({ error: "Invalid or expired session." }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await service
    .from("users")
    .select("id, role, is_developer, is_restricted_admin")
    .eq("auth_id", userData.user.id)
    .maybeSingle();
  const role = profile?.role as ApiRole | undefined;

  if (profileError || !role || !allowedRoles.includes(role)) {
    return { response: NextResponse.json({ error: "You are not allowed to perform this action." }, { status: 403 }) };
  }

  const restricted = role === "admin" && profile?.is_restricted_admin === true;
  if (role === "admin" && !options.adminChallenge && !trustsDevice(req.cookies.get(TRUST_COOKIE)?.value, userData.user.id)) {
    return { response: NextResponse.json({ error: "Verify this device to continue.", needsOtp: true }, { status: 403 }) };
  }
  if (restricted && !options.adminChallenge && req.method !== "GET" && req.method !== "HEAD" && !options.allowOwnPasswordChange) {
    return { response: NextResponse.json({ error: "This administrator account is read-only." }, { status: 403 }) };
  }

  if (restricted && !options.adminChallenge && !options.allowOwnPasswordChange && !restrictedReadPaths.has(req.nextUrl.pathname)) {
    return { response: NextResponse.json({ error: "This resource requires additional administrator permissions." }, { status: 403 }) };
  }

  // Maintenance mode: every API route that signs a user in passes through here, so one check covers
  // them all. The developer always gets through (so they can switch it off); admins only if allowed.
  const maintenance = await getMaintenance(service);
  if (maintenance.enabled && !profile?.is_developer && !(maintenance.allowAdmins && role === "admin")) {
    return {
      response: NextResponse.json(
        {
          error: maintenance.message || "The portal is undergoing maintenance. Please check back shortly.",
          maintenance: true,
          backAt: maintenance.backAt,
        },
        { status: 503 }
      ),
    };
  }

  // Server-side enforcement of the fee lock: a locked student may only reach routes
  // that opt in with allowLockedStudent (payments, password change, app settings).
  if (role === "student" && !options.allowLockedStudent) {
    const ids = [userData.user.id, profile?.id].filter(Boolean) as string[];
    const { data: student, error: lockError } = await service
      .from("students")
      .select("portal_access_status")
      .in("user_id", ids)
      .maybeSingle();
    if (lockError || !student) {
      return { response: NextResponse.json({ error: "Unable to verify student access." }, { status: lockError ? 503 : 403 }) };
    }
    if (String(student?.portal_access_status || "").toLowerCase() === "locked") {
      return {
        response: NextResponse.json(
          { error: "Your portal access is locked. Please contact the school administrator.", locked: true },
          { status: 403 }
        ),
      };
    }
  }

  return { actor: { restricted, authId: userData.user.id, dbUserId: profile?.id, email: userData.user.email, role, service } };
}

export async function requireTeacherAssignment(
  actor: ApiActor,
  classId: string,
  subjectId: string,
  academicSessionId?: string
): Promise<boolean> {
  if (actor.role === "admin") return true;
  if (!classId || !subjectId) return false;

  const idList = Array.from(new Set([actor.authId, actor.dbUserId].filter(Boolean)));

  let assignment = actor.service
    .from("subject_teacher_assignments")
    .select("id")
    .in("teacher_user_id", idList)
    .eq("class_id", classId)
    .eq("subject_id", subjectId)
    .eq("status", "active");

  if (academicSessionId) {
    assignment = assignment.eq("academic_session_id", academicSessionId);
  }

  const { data } = await assignment.limit(1);
  return Boolean(data?.length);
}

/** Only a form teacher for this session can manage class-wide records. Legacy direct
 * class assignments describe the current class, so they cannot grant historical access. */
export async function canManageClass(actor: ApiActor, classId: string, sessionId: string) {
  if (actor.role === "admin") return true;
  if (actor.role !== "teacher" || !classId || !sessionId) return false;
  const ids = [actor.authId, actor.dbUserId].filter(Boolean) as string[];
  const [assigned, session, direct] = await Promise.all([
    actor.service.from("class_teacher_assignments").select("id").eq("class_id", classId)
      .eq("academic_session_id", sessionId).eq("status", "active").in("teacher_user_id", ids).limit(1),
    actor.service.from("academic_sessions").select("is_current").eq("id", sessionId).maybeSingle(),
    actor.service.from("classes").select("class_teacher_id").eq("id", classId).maybeSingle(),
  ]);
  return Boolean(assigned.data?.length || (session.data?.is_current && ids.includes(direct.data?.class_teacher_id)));
}

/**
 * Gates the Dev Tools page: an admin flagged is_developer on their own
 * users row, not a hardcoded email (keeps it manageable without a deploy
 * and out of source control).
 */
export async function requireDeveloper(actor: ApiActor): Promise<boolean> {
  if (actor.role !== "admin" || !actor.dbUserId) return false;
  const { data } = await actor.service.from("users").select("is_developer").eq("id", actor.dbUserId).maybeSingle();
  return Boolean(data?.is_developer);
}

