import { NextRequest, NextResponse } from "next/server";
import { isTermEditable } from "@/lib/termPermissions";
import { requireApiActor, requireTeacherAssignment } from "@/lib/apiAuth";
import { calculateTR, isFilled, isSeniorClass, normalizeBreakdown, validateRawScores, weeksForFrequency } from "@/lib/gradingEngine";
import { logAudit } from "@/lib/audit";
import { notifyAdmins } from "@/lib/notify";
import { isTermCode } from "@/lib/serverContext";

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const records = Array.isArray(body) ? body : body?.records ?? [];
  const requestedIds = body?.deletedResultIds ?? [];
  if (!Array.isArray(records) || !Array.isArray(requestedIds) ||
      records.length + requestedIds.length > 500 ||
      requestedIds.some((id: unknown) => typeof id !== "string" || !id) ||
      records.some(r => !r?.student_id || !r.class_id || !r.subject_id || !r.session || !isTermCode(r.term))) {
    return NextResponse.json({ error: "Invalid score sheet or batch size." }, { status: 400 });
  }
  let deletedResultIds: string[] = Array.from(new Set<string>(requestedIds));

  if (!records.length && !deletedResultIds.length) {
    return NextResponse.json({ error: "No records or deletions provided." }, { status: 400 });
  }

  const service = actor.service;

  const { data: deletions, error: lookupError } = deletedResultIds.length
    ? await service.from("results").select("id, class_id, subject_id, session, term, academic_session_id, pr1_status, pr2_status, pr3_status, tr_status, score_breakdown").in("id", deletedResultIds)
    : { data: [], error: null };
  if (lookupError) return NextResponse.json({ error: "Could not check records for deletion." }, { status: 503 });
  deletedResultIds = (deletions || []).map(r => r.id);
  const targets = [...records, ...(deletions || [])];
  if (!targets.length) return NextResponse.json({ ok: true, count: 0, deleted: 0 });
  const sheet = targets[0];
  if (targets.some(r => r.class_id !== sheet.class_id || r.subject_id !== sheet.subject_id || r.term !== sheet.term || r.session !== sheet.session)) {
    return NextResponse.json({ error: "Submit one class, subject, session and term at a time." }, { status: 400 });
  }
  const [sessionRow, settings] = await Promise.all([
    service.from("academic_sessions").select("id").eq("name", sheet.session).maybeSingle(),
    service.from("app_settings").select("current_session, current_term").limit(1).maybeSingle(),
  ]);
  if (sessionRow.error || settings.error || !settings.data?.current_session) {
    return NextResponse.json({ error: "Cannot verify the school session." }, { status: 503 });
  }
  const sessionId = sessionRow.data?.id;
  if (!sessionId || targets.some(r => r.academic_session_id && r.academic_session_id !== sessionId)) {
    return NextResponse.json({ error: "Academic session mismatch." }, { status: 400 });
  }
  if (!(await requireTeacherAssignment(actor, sheet.class_id, sheet.subject_id, sessionId)) ||
      !(await isTermEditable(sheet.session, sheet.term, service, settings.data.current_term, settings.data.current_session))) {
    return NextResponse.json({ error: "This sheet is outside your assignment or its term is locked." }, { status: 403 });
  }
  if (deletions?.some(r => [r.pr1_status, r.pr2_status, r.pr3_status, r.tr_status].includes("published"))) {
    return NextResponse.json({ error: "Recall published results before removing scores." }, { status: 409 });
  }
  if (records.length) {
    const ids = [...new Set(records.map(r => r.student_id))];
    const historical = sheet.session !== settings.data.current_session;
    const roster = historical
      ? await service.from("student_enrollments").select("student_id").eq("academic_session_id", sessionId).eq("class_id", sheet.class_id).in("student_id", ids)
      : await service.from("students").select("id").eq("class_id", sheet.class_id).in("id", ids);
    if (roster.error || roster.data?.length !== ids.length) {
      return NextResponse.json({ error: "Student outside the selected class roster." }, { status: 403 });
    }
  }

  // Validate score bounds for all records to guarantee data integrity
  if (deletions?.some(r => !r.score_breakdown)) {
    return NextResponse.json({ error: "A legacy result without an itemized score sheet cannot be cleared here." }, { status: 409 });
  }
  for (const record of records) {
    const raw = record.score_breakdown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
        (["cw", "hw", "tests"] as const).some(k => !Array.isArray(raw[k]) || raw[k].length > (k === "tests" ? 3 : 10)) ||
        [...raw.cw, ...raw.hw, ...raw.tests, raw.exam, raw.project].some(v =>
          v != null && typeof v !== "number" && typeof v !== "string")) {
      return NextResponse.json({ error: "Provide an itemized score sheet." }, { status: 400 });
    }
    const { valid } = validateRawScores(raw);
    if (!valid) return NextResponse.json({ error: "A score is outside its allowed range." }, { status: 400 });
    if (![...raw.cw, ...raw.hw, ...raw.tests, raw.exam, raw.project].some(isFilled)) {
      return NextResponse.json({ error: "Enter a score before saving this row." }, { status: 400 });
    }
  }

  // Whoever saves as a teacher is recorded on the score, so late or wrong entries can be traced.
  // Admin edits leave the existing teacher in place rather than overwriting it. It is added to
  // every record in the request alike, so the batch has one consistent shape.
  const enteredBy = actor.role === "teacher" && actor.dbUserId ? { teacher_id: actor.dbUserId } : {};

  const cls = records.length ? await service.from("classes").select("name,subject_group_code").eq("id", sheet.class_id).single() : null;
  if (cls?.error) return NextResponse.json({ error: "Could not load the class." }, { status: 503 });
  const schedule = cls?.data?.subject_group_code ? await service.from("subject_group_subjects").select("frequency")
    .eq("group_code", cls.data.subject_group_code).eq("subject_id", sheet.subject_id).maybeSingle() : null;
  if (schedule?.error) return NextResponse.json({ error: "Could not load the assessment schedule." }, { status: 503 });
  const weeks = schedule?.data ? weeksForFrequency(schedule.data.frequency || "fortnightly") : undefined;

  function calculatedComponents(row: any) {
    const result = calculateTR(normalizeBreakdown(row), { weeks, isSenior: isSeniorClass(cls?.data?.name) });
    return { cw: result.scaled.cw, hw: result.scaled.hw, test: result.scaled.tests,
      project: result.scaled.project, exam: result.scaled.exam, grade: result.grade };
  }

  // Only score fields are accepted from the client. Approval and publishing
  // status can only be changed by the admin endpoints.
  const cleanRecords = records.map((r: any) => ({
    ...enteredBy,
    student_id: r.student_id,
    subject_id: r.subject_id,
    class_id: r.class_id,
    term: r.term,
    session: r.session,
    academic_session_id: sessionId,
    ...calculatedComponents(r),
    score_breakdown: r.score_breakdown,
    status: r.status === "submitted" ? "submitted" : "draft",
    ...(r.status === "submitted" ? { return_reason: null } : {}),
  }));

  // Students marked "Not offering" for a subject cannot receive scores for it.
  if (cleanRecords.length) {
    const sessions = Array.from(new Set(cleanRecords.map((r: any) => r.session).filter(Boolean)));
    const { data: optouts, error: optErr } = await service
      .from("student_subject_optouts")
      .select("student_id, subject_id, session")
      .in("student_id", cleanRecords.map((r: any) => r.student_id))
      .in("session", sessions.length ? sessions : [""]);
    if (optErr) return NextResponse.json({ error: "Could not verify subject enrollment." }, { status: 503 });
    if (optouts?.length) {
      const blocked = new Set(optouts.map((o: any) => `${o.student_id}:${o.subject_id}:${o.session}`));
      if (cleanRecords.some((r: any) => blocked.has(`${r.student_id}:${r.subject_id}:${r.session}`))) {
        return NextResponse.json(
          { error: "A student marked 'Not offering' for this subject cannot receive scores. Untick 'Not offering' first." },
          { status: 400 }
        );
      }
    }
  }


  try {
    const { error } = await service.rpc("save_score_sheet", {
      p_records: cleanRecords, p_delete_ids: deletedResultIds,
      p_class: sheet.class_id, p_subject: sheet.subject_id, p_session: sheet.session, p_term: sheet.term,
    });
    if (error) {
      const conflict = error.code === "P0001";
      return NextResponse.json({ error: conflict ? "Score sheet changed. Reload before saving." : "Score sheet could not be saved." },
        { status: conflict ? 409 : 503 });
    }

    if (!cleanRecords.length) {
      if (deletedResultIds.length) {
        await logAudit(actor, {
          action: "scores.delete",
          entityType: "results",
          summary: `Removed ${deletedResultIds.length} score record(s)`,
          metadata: { ids: deletedResultIds },
        });
      }
      return NextResponse.json({ ok: true, count: 0, deleted: deletedResultIds.length });
    }

    // Draft autosaves are not logged; submissions, admin edits and removals are.
    const submitted = cleanRecords.filter((r: any) => r.status === "submitted").length;
    if (submitted || actor.role === "admin" || deletedResultIds.length) {
      const first = cleanRecords[0];
      const [{ data: cls }, { data: sub }] = await Promise.all([
        service.from("classes").select("name").eq("id", first.class_id).maybeSingle(),
        service.from("subjects").select("name").eq("id", first.subject_id).maybeSingle(),
      ]);

      await logAudit(actor, {
        action: submitted ? "scores.submit" : "scores.edit",
        entityType: "results",
        entityId: first.class_id,
        summary: `${submitted ? "Submitted" : "Edited"} ${cleanRecords.length} score record(s) — ${sub?.name || "subject"}, ${cls?.name || "class"} (${first.term}, ${first.session})${deletedResultIds.length ? `; removed ${deletedResultIds.length}` : ""}`,
        metadata: { class_id: first.class_id, subject_id: first.subject_id, term: first.term, session: first.session, records: cleanRecords.length, submitted, deleted: deletedResultIds.length },
      });

      // A teacher submitting scores for approval is the one event worth pinging admins for —
      // draft autosaves and "started editing" pings were pure noise (never read).
      if (submitted && actor.role === "teacher") {
        await notifyAdmins(actor, {
          type: "scores.submit",
          title: "Scores submitted for approval",
          body: `${sub?.name || "A subject"} — ${cls?.name || "class"} (${first.term}, ${first.session}): ${submitted} score(s) submitted.`,
          link: "/admin/approvals",
          metadata: { class_id: first.class_id, subject_id: first.subject_id, term: first.term, session: first.session },
        });
      }
    }

    return NextResponse.json({ ok: true, count: records.length });
  } catch (err: any) {
    console.error("handleSaveResults exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to save results." },
      { status: 500 }
    );
  }
}
