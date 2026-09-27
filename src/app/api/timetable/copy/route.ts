import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { isTermCode, resolveSession } from "@/lib/serverContext";
import { assignmentOptions } from "@/lib/timetableServer";

/**
 * POST { from_session, from_term, to_session, to_term, class_id? } (admin)
 * Copies a timetable into another term/session. A lesson is only copied when the same teacher is
 * assigned to that class and subject in the target session and neither the class nor the teacher is
 * already booked at that time; everything else is skipped and counted.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const b = await req.json().catch(() => null);
  if (!isTermCode(b?.from_term) || !isTermCode(b?.to_term)) {
    return NextResponse.json({ ok: false, error: "from_term and to_term are required." }, { status: 400 });
  }
  const [from, to] = await Promise.all([resolveSession(service, b?.from_session), resolveSession(service, b?.to_session)]);
  if (!from || !to) return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });
  if (from.id === to.id && b.from_term === b.to_term) {
    return NextResponse.json({ ok: false, error: "Choose a different term or session to copy into." }, { status: 400 });
  }

  let q = service.from("timetable_slots").select("*").eq("academic_session_id", from.id).eq("term_code", b.from_term);
  if (b?.class_id) q = q.eq("class_id", String(b.class_id));
  const { data: source } = await q;
  if (!source?.length) return NextResponse.json({ ok: false, error: "There is no timetable in the source term to copy." }, { status: 404 });

  const { data: taken } = await service
    .from("timetable_slots")
    .select("class_id, teacher_user_id, day_of_week, period_id")
    .eq("academic_session_id", to.id)
    .eq("term_code", b.to_term);
  const classBusy = new Set((taken || []).map((t: any) => `${t.class_id}|${t.day_of_week}|${t.period_id}`));
  const teacherBusy = new Set((taken || []).map((t: any) => `${t.teacher_user_id}|${t.day_of_week}|${t.period_id}`));

  const assignCache = new Map<string, Set<string>>();
  const allowedFor = async (classId: string, subjectId: string) => {
    const key = `${classId}|${subjectId}`;
    if (!assignCache.has(key)) {
      const opts = await assignmentOptions(service, to.id, classId, subjectId);
      assignCache.set(key, new Set(opts.map((o) => o.teacher_user_id)));
    }
    return assignCache.get(key)!;
  };

  const toInsert: any[] = [];
  const skipped = { notAssigned: 0, occupied: 0 };
  for (const s of source as any[]) {
    const cKey = `${s.class_id}|${s.day_of_week}|${s.period_id}`;
    const tKey = `${s.teacher_user_id}|${s.day_of_week}|${s.period_id}`;
    if (classBusy.has(cKey) || teacherBusy.has(tKey)) {
      skipped.occupied++;
      continue;
    }
    if (!(await allowedFor(s.class_id, s.subject_id)).has(s.teacher_user_id)) {
      skipped.notAssigned++;
      continue;
    }
    classBusy.add(cKey);
    teacherBusy.add(tKey);
    toInsert.push({
      academic_session_id: to.id,
      term_code: b.to_term,
      class_id: s.class_id,
      day_of_week: s.day_of_week,
      period_id: s.period_id,
      subject_id: s.subject_id,
      teacher_user_id: s.teacher_user_id,
      room: s.room,
      created_by: actor.dbUserId ?? null,
    });
  }

  if (toInsert.length) {
    const { error } = await service.from("timetable_slots").insert(toInsert);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await logAudit(actor, {
    action: "timetable.copy",
    entityType: "timetable",
    summary: `Copied timetable ${from.name} ${b.from_term} → ${to.name} ${b.to_term}: ${toInsert.length} lessons copied, ${skipped.notAssigned + skipped.occupied} skipped`,
    metadata: { copied: toInsert.length, ...skipped },
  });
  return NextResponse.json({
    ok: true,
    copied: toInsert.length,
    skipped,
    message: `Copied ${toInsert.length} lesson(s).${skipped.notAssigned ? ` ${skipped.notAssigned} skipped (teacher no longer assigned).` : ""}${skipped.occupied ? ` ${skipped.occupied} skipped (already booked).` : ""}`,
  });
}
