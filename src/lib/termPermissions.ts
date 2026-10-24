import { SupabaseClient } from "@supabase/supabase-js";

async function sessionIdByName(service: SupabaseClient, session: string): Promise<string | null> {
  const { data } = await service.from("academic_sessions").select("id").eq("name", session).maybeSingle();
  return data?.id || null;
}

/** Whether teachers may edit scores for this session/term. The current term is always editable. */
export async function isTermEditable(
  session: string,
  term: string,
  service: SupabaseClient | null,
  currentTerm: string
): Promise<boolean> {
  if (term === currentTerm) return true;
  if (!service) return false;
  try {
    const sessionId = await sessionIdByName(service, session);
    if (!sessionId) return false;
    const { data: row } = await service
      .from("academic_terms")
      .select("allow_teacher_edit")
      .eq("academic_session_id", sessionId)
      .eq("term_code", term)
      .maybeSingle();
    return Boolean(row?.allow_teacher_edit);
  } catch {
    return false;
  }
}

/** Persist the admin's lock/unlock of a non-current term. Returns an error message on failure. */
export async function setTermEditable(
  service: SupabaseClient,
  session: string,
  term: string,
  allow: boolean
): Promise<string | null> {
  const sessionId = await sessionIdByName(service, session);
  if (!sessionId) return `Session "${session}" was not found.`;
  const { error } = await service
    .from("academic_terms")
    .upsert(
      { academic_session_id: sessionId, term_code: term, allow_teacher_edit: allow },
      { onConflict: "academic_session_id,term_code" }
    );
  return error ? error.message : null;
}
