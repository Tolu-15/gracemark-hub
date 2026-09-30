import { ApiActor, requireTeacherAssignment } from "@/lib/apiAuth";

/** Resolves the students.id row for the signed-in student actor. */
export async function resolveStudentRecord(actor: ApiActor) {
  const ids = [actor.authId, actor.dbUserId].filter(Boolean) as string[];
  const { data } = await actor.service
    .from("students")
    .select("id, name, admission_no, class_id")
    .in("user_id", ids)
    .maybeSingle();
  return data as { id: string; name: string; admission_no: string; class_id: string } | null;
}

/** Admin, the exam's creator, or a teacher currently assigned to its class/subject may manage it. */
export async function canManageExam(
  actor: ApiActor,
  exam: { created_by: string; class_id: string; subject_id: string; academic_session_id?: string | null }
): Promise<boolean> {
  if (actor.role === "admin") return true;
  if (actor.role !== "teacher") return false;
  if (actor.dbUserId && exam.created_by === actor.dbUserId) return true;
  return requireTeacherAssignment(actor, exam.class_id, exam.subject_id, exam.academic_session_id || undefined);
}
