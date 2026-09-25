/**
 * Class subject lists.
 * Every class points at one subject group (JSS, SSS Science, SSS Arts, SSS Commercial).
 * A student takes every subject in their class's group, minus any subject a
 * teacher has marked "Not offering" for them in the current session.
 */

export interface SubjectGroup {
  code: string;
  name: string;
  level: "junior" | "senior" | "both";
  display_order: number;
}

export interface GroupSubject {
  subject_id: string;
  subject_name: string;
  credit_unit: number;
  display_order: number;
  frequency: "weekly" | "fortnightly";
}

export const MIGRATION_HINT =
  "Subject lists are not set up in the database yet. Run supabase/022_subject_groups_and_results_overhaul.sql in the Supabase SQL editor.";

/** Subjects (with credit units) for a class, in report order. */
export async function getClassSubjects(service: any, classId: string): Promise<GroupSubject[]> {
  const { data: cls, error: clsErr } = await service
    .from("classes")
    .select("id, subject_group_code")
    .eq("id", classId)
    .maybeSingle();
  if (clsErr) throw clsErr;
  if (!cls?.subject_group_code) return [];

  const { data, error } = await service
    .from("subject_group_subjects")
    .select("subject_id, credit_unit, display_order, frequency, subjects(name)")
    .eq("group_code", cls.subject_group_code)
    .order("display_order", { ascending: true });
  if (error) throw error;

  return (data || []).map((r: any) => ({
    subject_id: r.subject_id,
    subject_name: r.subjects?.name || "Subject",
    credit_unit: Number(r.credit_unit) || 0,
    display_order: r.display_order ?? 0,
    frequency: r.frequency === "weekly" ? "weekly" : "fortnightly",
  }));
}

/** Set of `${studentId}:${subjectId}` pairs marked "Not offering" in a session. */
export async function getOptOuts(service: any, session: string, studentIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (!studentIds.length || !session) return set;
  const { data, error } = await service
    .from("student_subject_optouts")
    .select("student_id, subject_id")
    .eq("session", session)
    .in("student_id", studentIds);
  if (error) throw error;
  (data || []).forEach((r: any) => set.add(`${r.student_id}:${r.subject_id}`));
  return set;
}
