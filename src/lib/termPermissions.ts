import { SupabaseClient } from "@supabase/supabase-js";

// In-memory override fallback for the running instance
const termEditOverrides = new Map<string, boolean>();

export function setTermEditOverride(session: string, term: string, allow: boolean) {
  termEditOverrides.set(`${session}:${term}`, allow);
}

export async function isTermEditable(
  session: string,
  term: string,
  service: SupabaseClient | null,
  currentTerm: string
): Promise<boolean> {
  if (term === currentTerm) return true;
  const key = `${session}:${term}`;
  if (termEditOverrides.has(key)) {
    return Boolean(termEditOverrides.get(key));
  }
  if (service) {
    try {
      const { data: tRow } = await service
        .from("terms")
        .select("*")
        .eq("session", session)
        .eq("term", term)
        .maybeSingle();

      if (tRow) {
        if (typeof tRow.allow_teacher_edit === "boolean") return tRow.allow_teacher_edit;
        if (tRow.status) return tRow.status === "open";
      }
    } catch {
      // Table or column might not exist in some environments
    }
  }
  return false;
}
