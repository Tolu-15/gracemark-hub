import type { ApiActor } from "@/lib/apiAuth";

type Service = ApiActor["service"];

export const TERM_CODES = ["term1", "term2", "term3"] as const;
export type TermCode = (typeof TERM_CODES)[number];

export function isTermCode(v: unknown): v is TermCode {
  return typeof v === "string" && (TERM_CODES as readonly string[]).includes(v);
}

export interface SessionContext {
  sessionId: string;
  sessionName: string;
  term: TermCode;
}

/** The school's current session and term (Settings), resolved to ids. */
export async function getCurrentContext(service: Service): Promise<SessionContext | null> {
  const { data: settings } = await service.from("app_settings").select("*").limit(1).maybeSingle();
  const term = isTermCode((settings as any)?.current_term) ? ((settings as any).current_term as TermCode) : "term1";

  let sessionId: string | undefined = (settings as any)?.current_session_id || undefined;
  let sessionName: string | undefined = (settings as any)?.current_session || undefined;

  if (sessionId && !sessionName) {
    const { data } = await service.from("academic_sessions").select("id, name").eq("id", sessionId).maybeSingle();
    sessionName = data?.name;
  } else if (sessionName && !sessionId) {
    const { data } = await service.from("academic_sessions").select("id, name").eq("name", sessionName).maybeSingle();
    sessionId = data?.id;
  }
  if (!sessionId || !sessionName) {
    const { data } = await service.from("academic_sessions").select("id, name").eq("is_current", true).maybeSingle();
    sessionId = data?.id;
    sessionName = data?.name;
  }
  if (!sessionId || !sessionName) return null;
  return { sessionId, sessionName, term };
}

/** Resolve a session by name (or id); falls back to the current session when omitted. */
export async function resolveSession(
  service: Service,
  name?: string | null
): Promise<{ id: string; name: string } | null> {
  if (!name) {
    const cur = await getCurrentContext(service);
    return cur ? { id: cur.sessionId, name: cur.sessionName } : null;
  }
  const { data } = await service.from("academic_sessions").select("id, name").eq("name", name).maybeSingle();
  return data ? { id: data.id, name: data.name } : null;
}

export interface UserRow {
  id: string;
  auth_id: string;
  display_name: string | null;
  email: string | null;
}

/**
 * Teacher references are stored either as users.id or as the auth id. This maps any of
 * those raw ids to the canonical users row so comparisons are reliable.
 */
export async function usersByAnyId(service: Service, rawIds: string[]): Promise<Map<string, UserRow>> {
  const out = new Map<string, UserRow>();
  const ids = Array.from(new Set(rawIds.filter(Boolean)));
  if (!ids.length) return out;
  const list = ids.join(",");
  const { data } = await service
    .from("users")
    .select("id, auth_id, display_name, email")
    .or(`id.in.(${list}),auth_id.in.(${list})`);
  (data || []).forEach((u: any) => {
    out.set(u.id, u);
    if (u.auth_id) out.set(u.auth_id, u);
  });
  return out;
}

export const teacherLabel = (u?: UserRow | null) => u?.display_name || u?.email || "Teacher";

/** Classes a teacher is attached to (form master or subject teacher) in a session. */
export async function teacherClassIds(service: Service, actor: ApiActor, sessionId: string): Promise<Set<string>> {
  const ids = Array.from(new Set([actor.authId, actor.dbUserId].filter(Boolean))) as string[];
  const [cta, sta] = await Promise.all([
    service
      .from("class_teacher_assignments")
      .select("class_id")
      .in("teacher_user_id", ids)
      .eq("academic_session_id", sessionId)
      .eq("status", "active"),
    service
      .from("subject_teacher_assignments")
      .select("class_id")
      .in("teacher_user_id", ids)
      .eq("academic_session_id", sessionId)
      .eq("status", "active"),
  ]);
  const out = new Set<string>();
  (cta.data || []).forEach((r: any) => r.class_id && out.add(r.class_id));
  (sta.data || []).forEach((r: any) => r.class_id && out.add(r.class_id));
  return out;
}

/** The class a student sits in for a session (enrollment first, then their current class). */
export async function studentClassId(service: Service, actor: ApiActor, sessionId: string): Promise<string | null> {
  const ids = Array.from(new Set([actor.authId, actor.dbUserId].filter(Boolean))) as string[];
  const { data: student } = await service.from("students").select("*").in("user_id", ids).maybeSingle();
  if (!student) return null;
  const { data: enr } = await service
    .from("student_enrollments")
    .select("class_id")
    .eq("student_id", (student as any).id)
    .eq("academic_session_id", sessionId)
    .maybeSingle();
  return enr?.class_id || (student as any).current_class_id || (student as any).class_id || null;
}
