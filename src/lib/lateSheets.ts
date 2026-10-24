import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetchAll";
import { getOptOuts } from "@/lib/subjectGroups";
import { usersByAnyId } from "@/lib/serverContext";

export interface LateSheet {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  /** Students who should have a score for this subject (class size minus "not offering"). */
  expected: number;
  /** Students whose scores are submitted or approved. */
  done: number;
  draft: number;
  returned: number;
  state: "not_started" | "in_progress" | "returned";
}

export interface LateTeacher {
  userId: string;
  name: string;
  email: string;
  sheets: LateSheet[];
}

export interface LateSheetsReport {
  term: string;
  session: string;
  teachers: LateTeacher[];
  totalSheets: number;
  completeSheets: number;
}

export const TERM_LABEL: Record<string, string> = { term1: "1st Term", term2: "2nd Term", term3: "3rd Term" };

const DONE = new Set(["submitted", "approved", "published"]);

/**
 * Every score sheet (class + subject) assigned to a teacher this term that is not fully submitted.
 * Throwaway "ZZ Test" classes are ignored. Read-only.
 */
export async function computeLateSheets(service: SupabaseClient): Promise<LateSheetsReport> {
  const { data: settings } = await service.from("app_settings").select("current_term, current_session, current_session_id").limit(1).maybeSingle();
  const term = settings?.current_term || "term1";
  const session = settings?.current_session || "";
  const sessionId = settings?.current_session_id || "";
  const empty: LateSheetsReport = { term, session, teachers: [], totalSheets: 0, completeSheets: 0 };
  if (!session || !sessionId) return empty;

  const [{ data: classes }, { data: subjects }, { data: assignments }, { data: students }] = await Promise.all([
    service.from("classes").select("id, name"),
    service.from("subjects").select("id, name"),
    service.from("subject_teacher_assignments").select("teacher_user_id, class_id, subject_id").eq("academic_session_id", sessionId).eq("status", "active"),
    service.from("students").select("id, class_id"),
  ]);

  const classes_ = new Map((classes || []).map((c: any) => [c.id as string, c.name as string]));
  const subjectName = new Map((subjects || []).map((s: any) => [s.id as string, s.name as string]));
  const isTestClass = (id: string) => String(classes_.get(id) || "").startsWith("ZZ Test");

  const studentsByClass = new Map<string, string[]>();
  (students || []).forEach((s: any) => {
    if (!s.class_id) return;
    (studentsByClass.get(s.class_id) || studentsByClass.set(s.class_id, []).get(s.class_id)!).push(s.id);
  });
  const optOuts = await getOptOuts(service, session, (students || []).map((s: any) => s.id));

  const results = await fetchAll<{ student_id: string; class_id: string; subject_id: string; status: string }>((from, to) =>
    service.from("results").select("student_id, class_id, subject_id, status").eq("term", term).eq("session", session).order("id").range(from, to) as any
  );
  const bySheet = new Map<string, { student_id: string; status: string }[]>();
  results.forEach((r) => {
    const key = `${r.class_id}:${r.subject_id}`;
    (bySheet.get(key) || bySheet.set(key, []).get(key)!).push(r);
  });

  const sheetFor = (classId: string, subjectId: string): LateSheet | null => {
    const pupils = studentsByClass.get(classId) || [];
    const expected = pupils.filter((id) => !optOuts.has(`${id}:${subjectId}`)).length;
    if (!expected) return null;
    const rows = bySheet.get(`${classId}:${subjectId}`) || [];
    const done = rows.filter((r) => DONE.has(r.status)).length;
    const draft = rows.filter((r) => r.status === "draft").length;
    const returned = rows.filter((r) => r.status === "returned").length;
    return {
      classId,
      className: classes_.get(classId) || "Class",
      subjectId,
      subjectName: subjectName.get(subjectId) || "Subject",
      expected,
      done,
      draft,
      returned,
      state: returned > 0 ? "returned" : rows.length === 0 ? "not_started" : "in_progress",
    };
  };

  const userMap = await usersByAnyId(service, (assignments || []).map((a: any) => a.teacher_user_id));
  const byTeacher = new Map<string, LateTeacher>();
  const seenSheets = new Set<string>();
  let completeSheets = 0;

  for (const a of (assignments || []) as any[]) {
    if (isTestClass(a.class_id)) continue;
    const sheet = sheetFor(a.class_id, a.subject_id);
    if (!sheet) continue;
    const sheetKey = `${a.class_id}:${a.subject_id}`;
    const complete = sheet.done >= sheet.expected;
    if (!seenSheets.has(sheetKey)) {
      seenSheets.add(sheetKey);
      if (complete) completeSheets++;
    }
    if (complete) continue;

    const user = userMap.get(a.teacher_user_id);
    if (!user) continue;
    const teacher = byTeacher.get(user.id) || { userId: user.id, name: user.display_name || user.email || "Teacher", email: user.email || "", sheets: [] };
    if (!teacher.sheets.some((s) => s.classId === sheet.classId && s.subjectId === sheet.subjectId)) teacher.sheets.push(sheet);
    byTeacher.set(user.id, teacher);
  }

  const teachers = Array.from(byTeacher.values());
  teachers.forEach((t) => t.sheets.sort((a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName)));
  teachers.sort((a, b) => b.sheets.length - a.sheets.length || a.name.localeCompare(b.name));
  return { term, session, teachers, totalSheets: seenSheets.size, completeSheets };
}
