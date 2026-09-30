import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notify";
import { isTermCode, resolveSession, teacherLabel, usersByAnyId } from "@/lib/serverContext";
import { assignmentOptions, recomputeClashFlags } from "@/lib/timetableServer";

/**
 * POST { session, term, class_id, day, period_id, subject_id, teacher_user_id, room? } (admin)
 * Puts one lesson on the timetable, replacing whatever the class had in that cell. Refused when
 *  - the teacher is not assigned to that class and subject this session, or
 *  - the period is a break.
 * If the teacher is already teaching another class at that time, the lesson is still saved but
 * both slots are flagged (has_clash) so the clash shows up red in the grid instead of being
 * silently blocked.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const b = await req.json().catch(() => null);
  const day = Number(b?.day);
  const classId = String(b?.class_id || "");
  const periodId = String(b?.period_id || "");
  const subjectId = String(b?.subject_id || "");
  const teacherId = String(b?.teacher_user_id || "");
  if (!isTermCode(b?.term) || !classId || !periodId || !subjectId || !teacherId || !(day >= 1 && day <= 5)) {
    return NextResponse.json({ ok: false, error: "session, term, class, day, period, subject and teacher are required." }, { status: 400 });
  }
  const session = await resolveSession(service, b?.session);
  if (!session) return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });

  const { data: period } = await service.from("timetable_periods").select("id, is_break, label").eq("id", periodId).maybeSingle();
  if (!period) return NextResponse.json({ ok: false, error: "Period not found." }, { status: 404 });
  if (period.is_break) return NextResponse.json({ ok: false, error: `${period.label} is a break; lessons cannot be scheduled in it.` }, { status: 400 });

  const allowed = await assignmentOptions(service, session.id, classId, subjectId);
  if (!allowed.some((o) => o.teacher_user_id === teacherId)) {
    return NextResponse.json(
      { ok: false, error: `That teacher is not assigned to this subject and class in ${session.name}. Assign them under Manage Teachers first.` },
      { status: 400 }
    );
  }

  // Teacher clash: same teacher, same session/term/day/period, anywhere else. Not blocked —
  // saved and flagged so it shows up red, and the admin is told about it in the response.
  const { data: clash } = await service
    .from("timetable_slots")
    .select("id, class_id, subject_id")
    .eq("academic_session_id", session.id)
    .eq("term_code", b.term)
    .eq("teacher_user_id", teacherId)
    .eq("day_of_week", day)
    .eq("period_id", periodId)
    .neq("class_id", classId)
    .limit(1);
  let clashWarning: string | undefined;
  if (clash?.length) {
    const [{ data: c }, { data: s }, users] = await Promise.all([
      service.from("classes").select("name").eq("id", clash[0].class_id).maybeSingle(),
      service.from("subjects").select("name").eq("id", clash[0].subject_id).maybeSingle(),
      usersByAnyId(service, [teacherId]),
    ]);
    clashWarning = `Clash: ${teacherLabel(users.get(teacherId))} is already teaching ${s?.name || "another subject"} in ${c?.name || "another class"} at that time.`;
  }

  await service
    .from("timetable_slots")
    .delete()
    .eq("academic_session_id", session.id)
    .eq("term_code", b.term)
    .eq("class_id", classId)
    .eq("day_of_week", day)
    .eq("period_id", periodId);

  const { data: row, error } = await service
    .from("timetable_slots")
    .insert({
      academic_session_id: session.id,
      term_code: b.term,
      class_id: classId,
      day_of_week: day,
      period_id: periodId,
      subject_id: subjectId,
      teacher_user_id: teacherId,
      room: b?.room ? String(b.room).slice(0, 40) : null,
      created_by: actor.dbUserId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    const isConflict = (error as any).code === "23505";
    const isTeacherConstraint = /uq_timetable_teacher_slot/.test(error.message);
    const message = isTeacherConstraint
      ? "This database hasn't been migrated to allow flagged clashes yet — run supabase/031_timetable_clash_flag.sql, then try again."
      : isConflict
        ? "That class is already booked at that time."
        : error.message;
    return NextResponse.json({ ok: false, clash: isConflict, error: message }, { status: isConflict ? 409 : 500 });
  }

  await recomputeClashFlags(service, session.id, b.term);

  const [{ data: cls }, { data: sub }] = await Promise.all([
    service.from("classes").select("name").eq("id", classId).maybeSingle(),
    service.from("subjects").select("name").eq("id", subjectId).maybeSingle(),
  ]);
  await logAudit(actor, {
    action: "timetable.set_slot",
    entityType: "timetable_slot",
    entityId: row.id,
    summary: `Set timetable slot — ${sub?.name || "subject"}, ${cls?.name || "class"} (${session.name}, ${b.term}, day ${day})`,
    metadata: { class_id: classId, subject_id: subjectId, teacher_user_id: teacherId, day, period_id: periodId },
  });

  const timetableBody = `${sub?.name || "A subject"} was scheduled for ${cls?.name || "a class"} (${session.name}, ${b.term}).`;
  await notifyUsers(actor, [teacherId], {
    type: "timetable.update",
    title: "Timetable updated",
    body: timetableBody,
    link: "/teacher/timetable",
    metadata: { class_id: classId, subject_id: subjectId, day, period_id: periodId },
  });

  const { data: classStudents } = await service.from("students").select("user_id").eq("class_id", classId);
  const rawStudentIds = (classStudents || []).map((s: any) => s.user_id).filter(Boolean);
  if (rawStudentIds.length) {
    const studentUserMap = await usersByAnyId(service, rawStudentIds);
    const studentRecipientIds = Array.from(new Set(Array.from(studentUserMap.values()).map((u) => u.id)));
    await notifyUsers(actor, studentRecipientIds, {
      type: "timetable.update",
      title: "Timetable updated",
      body: timetableBody,
      link: "/student/timetable",
      metadata: { class_id: classId, subject_id: subjectId, day, period_id: periodId },
    });
  }

  return NextResponse.json({ ok: true, id: row.id, clash: !!clashWarning, warning: clashWarning });
}

/** DELETE ?id= (admin) */
export async function DELETE(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });

  const { data: existing } = await service.from("timetable_slots").select("academic_session_id, term_code").eq("id", id).maybeSingle();
  const { error } = await service.from("timetable_slots").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (existing) await recomputeClashFlags(service, existing.academic_session_id, existing.term_code);
  return NextResponse.json({ ok: true });
}
