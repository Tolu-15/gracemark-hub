import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export type ApiRole = "admin" | "teacher" | "student";

export interface ApiActor {
  authId: string;
  dbUserId?: string;
  email?: string;
  role: ApiRole;
  service: NonNullable<ReturnType<typeof getServiceClient>>;
}

/**
 * Validates the Supabase access token before a route uses the service-role
 * client. Service-role queries bypass RLS, so every such route needs an
 * explicit server-side authorization check.
 */
export async function requireApiActor(
  req: NextRequest,
  allowedRoles: ApiRole[],
  options: { allowLockedStudent?: boolean } = {}
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
    .select("id, role")
    .eq("auth_id", userData.user.id)
    .maybeSingle();
  const role = profile?.role as ApiRole | undefined;

  if (profileError || !role || !allowedRoles.includes(role)) {
    return { response: NextResponse.json({ error: "You are not allowed to perform this action." }, { status: 403 }) };
  }

  // Server-side enforcement of the fee lock: a locked student may only reach routes
  // that opt in with allowLockedStudent (payments, password change, app settings).
  if (role === "student" && !options.allowLockedStudent) {
    const ids = [userData.user.id, profile?.id].filter(Boolean) as string[];
    const { data: student } = await service
      .from("students")
      .select("portal_access_status")
      .in("user_id", ids)
      .maybeSingle();
    if (String(student?.portal_access_status || "").toLowerCase() === "locked") {
      return {
        response: NextResponse.json(
          { error: "Your portal access is locked. Please contact the school administrator.", locked: true },
          { status: 403 }
        ),
      };
    }
  }

  return { actor: { authId: userData.user.id, dbUserId: profile?.id, email: userData.user.email, role, service } };
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
    const { data: sessMatch } = await assignment.eq("academic_session_id", academicSessionId).limit(1);
    if (sessMatch && sessMatch.length > 0) return true;
  }

  // Fallback to active assignment across sessions if not explicitly constrained
  const { data } = await assignment.limit(1);
  return Boolean(data?.length);
}

