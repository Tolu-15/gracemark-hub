import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export type ApiRole = "admin" | "teacher" | "student";

export interface ApiActor {
  authId: string;
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
  allowedRoles: ApiRole[]
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
    .select("role")
    .eq("auth_id", userData.user.id)
    .maybeSingle();
  const role = profile?.role as ApiRole | undefined;

  if (profileError || !role || !allowedRoles.includes(role)) {
    return { response: NextResponse.json({ error: "You are not allowed to perform this action." }, { status: 403 }) };
  }

  return { actor: { authId: userData.user.id, role, service } };
}

export async function requireTeacherAssignment(
  actor: ApiActor,
  classId: string,
  subjectId: string,
  academicSessionId?: string
): Promise<boolean> {
  if (actor.role === "admin") return true;
  if (!classId || !subjectId) return false;

  let assignment = actor.service
    .from("subject_teacher_assignments")
    .select("id")
    .eq("teacher_user_id", actor.authId)
    .eq("class_id", classId)
    .eq("subject_id", subjectId)
    .eq("status", "active");
  if (academicSessionId) assignment = assignment.eq("academic_session_id", academicSessionId);
  const { data } = await assignment.limit(1);
  return Boolean(data?.length);
}
