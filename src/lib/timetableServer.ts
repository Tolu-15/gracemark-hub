import type { ApiActor } from "@/lib/apiAuth";
import { teacherLabel, usersByAnyId } from "@/lib/serverContext";

type Service = ApiActor["service"];

export interface AssignmentOption {
  subject_id: string;
  subject_name: string;
  periods_per_week: number;
  teacher_user_id: string; // canonical users.id
  teacher_name: string;
}

/**
 * Subject/teacher pairs actually assigned to a class in a session. The timetable may only
 * use these, so it can never contradict the teacher assignments that drive score entry.
 */
export async function assignmentOptions(
  service: Service,
  sessionId: string,
  classId: string,
  subjectId?: string
): Promise<AssignmentOption[]> {
  let q = service
    .from("subject_teacher_assignments")
    .select("subject_id, teacher_user_id, subjects(name, periods_per_week)")
    .eq("academic_session_id", sessionId)
    .eq("class_id", classId)
    .eq("status", "active");
  if (subjectId) q = q.eq("subject_id", subjectId);
  const { data } = await q;
  const rows = (data || []) as any[];
  const users = await usersByAnyId(service, rows.map((r) => r.teacher_user_id));

  const seen = new Set<string>();
  const out: AssignmentOption[] = [];
  for (const r of rows) {
    const u = users.get(r.teacher_user_id);
    if (!u) continue;
    const key = `${r.subject_id}:${u.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const subj = Array.isArray(r.subjects) ? r.subjects[0] : r.subjects;
    out.push({
      subject_id: r.subject_id,
      subject_name: subj?.name || "Subject",
      periods_per_week: Number(subj?.periods_per_week) || 0,
      teacher_user_id: u.id,
      teacher_name: teacherLabel(u),
    });
  }
  return out.sort((a, b) => a.subject_name.localeCompare(b.subject_name));
}

/** Adds class, subject and teacher names to raw slot rows. */
export async function decorateSlots(service: Service, slots: any[]) {
  if (!slots.length) return [];
  const classIds = Array.from(new Set(slots.map((s) => s.class_id)));
  const subjectIds = Array.from(new Set(slots.map((s) => s.subject_id)));
  const [{ data: classes }, { data: subjects }, users] = await Promise.all([
    service.from("classes").select("id, name").in("id", classIds),
    service.from("subjects").select("id, name").in("id", subjectIds),
    usersByAnyId(service, slots.map((s) => s.teacher_user_id)),
  ]);
  const cn = new Map((classes || []).map((c: any) => [c.id, c.name]));
  const sn = new Map((subjects || []).map((s: any) => [s.id, s.name]));
  return slots.map((s) => ({
    id: s.id,
    class_id: s.class_id,
    className: cn.get(s.class_id) || "",
    day: s.day_of_week,
    period_id: s.period_id,
    subject_id: s.subject_id,
    subjectName: sn.get(s.subject_id) || "",
    teacher_user_id: s.teacher_user_id,
    teacherName: teacherLabel(users.get(s.teacher_user_id)),
    room: s.room || "",
    has_clash: !!s.has_clash,
  }));
}

/**
 * Recomputes the has_clash flag for every slot of a session/term: a slot clashes when its
 * teacher has another lesson (any class) in the same day/period. Called after any insert or
 * delete so the flag always reflects the current state, instead of blocking the save itself.
 */
export async function recomputeClashFlags(service: Service, sessionId: string, term: string) {
  const { data } = await service
    .from("timetable_slots")
    .select("id, teacher_user_id, day_of_week, period_id, has_clash")
    .eq("academic_session_id", sessionId)
    .eq("term_code", term);
  const rows = data || [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.teacher_user_id}|${r.day_of_week}|${r.period_id}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const toFlag: string[] = [];
  const toClear: string[] = [];
  for (const r of rows) {
    const key = `${r.teacher_user_id}|${r.day_of_week}|${r.period_id}`;
    const clashes = (counts.get(key) || 0) > 1;
    if (clashes && !r.has_clash) toFlag.push(r.id);
    if (!clashes && r.has_clash) toClear.push(r.id);
  }
  await Promise.all([
    toFlag.length ? service.from("timetable_slots").update({ has_clash: true }).in("id", toFlag) : null,
    toClear.length ? service.from("timetable_slots").update({ has_clash: false }).in("id", toClear) : null,
  ]);
}
