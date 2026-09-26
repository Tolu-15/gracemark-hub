import { SupabaseClient } from "@supabase/supabase-js";

// Global in-memory overrides for term editability (persisted across warm lambdas/requests)
const termEditOverrides = new Map<string, boolean>();

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
  }
  return false;
}

export function setTermEditOverride(session: string, term: string, allowEdit: boolean) {
  const key = `${session}:${term}`;
  termEditOverrides.set(key, allowEdit);
}
