import { NextRequest, NextResponse } from "next/server";
import { isTermEditable } from "@/lib/termPermissions";
import { requireApiActor, requireTeacherAssignment } from "@/lib/apiAuth";
import { calculateTR, hasEnteredScores, isSeniorClass, validateRawScores, weeksForFrequency } from "@/lib/gradingEngine";
import { mergeMarks } from "@/lib/scoreChanges";
import { logAudit } from "@/lib/audit";
import { notifyAdmins } from "@/lib/notify";
import { isTermCode } from "@/lib/serverContext";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string, status: number) => NextResponse.json({ error }, { status });
const conflict = () => fail("This score sheet has changed. Review your entries and reload the sheet before saving.", 409);

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  const body = await req.json().catch(() => null);
  if (!body) return fail("Invalid request.", 400);
  if (body.protocol !== 2) return fail("Refresh the portal before saving this sheet. Older saves cannot be applied safely.", 409);
  const { sheet, edits, submit } = body;
  if (!sheet?.class_id || !sheet.subject_id || !sheet.session || !isTermCode(sheet.term) ||
      typeof submit !== "boolean" || !Array.isArray(edits) || !edits.length || edits.length > 500 ||
      edits.some(e => !e?.student_id || !Array.isArray(e.changes) ||
        !(e.expected === null || uuid.test(e.expected)) || !uuid.test(e.next) || e.next === e.expected) ||
      new Set(edits.map(e => e.student_id)).size !== edits.length) return fail("Invalid score edits.", 400);

  const [sessionRow, settings] = await Promise.all([
    service.from("academic_sessions").select("id").eq("name", sheet.session).maybeSingle(),
    service.from("app_settings").select("current_session,current_term").limit(1).maybeSingle(),
  ]);
  if (sessionRow.error || settings.error || !settings.data) return fail("Cannot verify the school session.", 503);
  const sessionId = sessionRow.data?.id;
  if (!sessionId) return fail("Unknown academic session.", 400);
  if (!(await requireTeacherAssignment(actor, sheet.class_id, sheet.subject_id, sessionId)) ||
      !(await isTermEditable(sheet.session, sheet.term, service, settings.data.current_term, settings.data.current_session))) {
    return fail("This sheet is outside your assignment or its term is locked.", 403);
  }
  const ids = edits.map(e => e.student_id);
  const [roster, existing, optouts, cls] = await Promise.all([
    sheet.session === settings.data.current_session
      ? service.from("students").select("id").eq("class_id", sheet.class_id).in("id", ids)
      : service.from("student_enrollments").select("student_id").eq("academic_session_id", sessionId).eq("class_id", sheet.class_id).in("student_id", ids),
    service.from("results").select("student_id,class_id,score_breakdown,score_version,status,pr1_status,pr2_status,pr3_status,tr_status")
      .eq("session", sheet.session).eq("term", sheet.term).eq("subject_id", sheet.subject_id).in("student_id", ids),
    service.from("student_subject_optouts").select("student_id").eq("session", sheet.session).eq("subject_id", sheet.subject_id).in("student_id", ids),
    service.from("classes").select("name,subject_group_code").eq("id", sheet.class_id).single(),
  ]);
  if (roster.error || existing.error || optouts.error || cls.error) return fail("Could not verify score sheet records.", 503);
  if (roster.data?.length !== ids.length || optouts.data?.length) return fail("A student is outside this subject's roster.", 403);
  const schedule = cls.data?.subject_group_code ? await service.from("subject_group_subjects").select("frequency")
    .eq("group_code", cls.data.subject_group_code).eq("subject_id", sheet.subject_id).maybeSingle() : null;
  if (schedule?.error) return fail("Could not load the assessment schedule.", 503);
  const weeks = schedule?.data ? weeksForFrequency(schedule.data.frequency) : undefined;
  const saved = new Map((existing.data || []).map(row => [row.student_id, row]));
  const records = [];
  for (const edit of edits) {
    const row = saved.get(edit.student_id);
    if (row?.class_id && row.class_id !== sheet.class_id) return conflict();
    if (row?.score_version === edit.next) continue; // Retry after the response was lost.
    if (!row && edit.clear === true && edit.expected !== null) continue; // Already removed.
    if ((row?.score_version ?? null) !== edit.expected) return conflict();
    if (row && !row.score_breakdown) return fail("This legacy result requires itemized marks before editing.", 409);
    let raw;
    try { raw = mergeMarks(row, edit.changes); }
    catch { return fail("Invalid assessment mark.", 400); }
    if (!validateRawScores(raw).valid) return fail("A mark is outside its allowed range.", 400);
    const empty = !hasEnteredScores(raw);
    if (empty && (!edit.clear || !row || !edit.changes.length)) return fail("Confirm clearing this student's scores.", 400);
    if (empty && [row?.pr1_status, row?.pr2_status, row?.pr3_status, row?.tr_status].includes("published")) {
      return fail("Recall published results before removing scores.", 409);
    }
    if (!edit.changes.length && (!submit || !row)) return fail("No assessment changes supplied.", 400);
    const tr = calculateTR(raw, { weeks, isSenior: isSeniorClass(cls.data?.name) });
    records.push({ student_id: edit.student_id, expected: edit.expected, score_version: edit.next,
      clear: empty, status_only: !edit.changes.length, score_breakdown: raw, ...tr.scaled,
      test: tr.scaled.tests, grade: tr.grade, status: submit ? "submitted" : "draft" });
  }
  if (records.length) {
    const { error } = await service.rpc("save_score_edits", {
      p_records: records, p_class: sheet.class_id, p_subject: sheet.subject_id, p_term: sheet.term,
      p_session: sheet.session, p_session_id: sessionId, p_teacher: actor.role === "teacher" ? actor.dbUserId : null,
    });
    if (error) return ["P0001", "23505", "40001"].includes(error.code) ? conflict() : fail("Score changes could not be saved.", 503);
    const deleted = records.filter(r => r.clear).length;
    if (submit || actor.role === "admin" || deleted) {
      const { data: subject } = await service.from("subjects").select("name").eq("id", sheet.subject_id).maybeSingle();
      const label = (subject?.name || "Subject") + ", " + cls.data?.name;
      const submitted = submit ? records.length - deleted : 0;
      await logAudit(actor, { action: submitted ? "scores.submit" : deleted ? "scores.delete" : "scores.edit",
        entityType: "results", entityId: sheet.class_id, summary: "Saved " + records.length + " score record(s) for " + label,
        metadata: { ...sheet, records: records.length, submitted, deleted } });
      if (submitted && actor.role === "teacher") await notifyAdmins(actor, { type: "scores.submit",
        title: "Scores submitted for approval", body: label + ": " + submitted + " score(s) submitted.",
        link: "/admin/approvals", metadata: { ...sheet } });
    }
  }
  return NextResponse.json({ ok: true, count: records.length });
}
