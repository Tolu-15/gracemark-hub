import { NextRequest, NextResponse } from "next/server";
import { isTermEditable } from "@/lib/termPermissions";
import { requireApiActor, requireTeacherAssignment } from "@/lib/apiAuth";
import { validateRawScores } from "@/lib/gradingEngine";

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

  const records = body.records || (Array.isArray(body) ? body : []);
  const deletedResultIds: string[] = Array.isArray(body.deletedResultIds) ? body.deletedResultIds : [];

  if (!records.length && !deletedResultIds.length) {
    return NextResponse.json({ error: "No records or deletions provided." }, { status: 400 });
  }

  const service = actor.service;

  for (const record of records) {
    const assigned = await requireTeacherAssignment(
      actor,
      String(record.class_id || ""),
      String(record.subject_id || ""),
      record.academic_session_id
    );
    if (!assigned) {
      return NextResponse.json({ error: "You are not assigned to this class and subject." }, { status: 403 });
    }
  }

  const studentClassPairs = new Map<string, string>();
  for (const record of records) {
    if (record.student_id && record.class_id) studentClassPairs.set(String(record.student_id), String(record.class_id));
  }
  if (studentClassPairs.size) {
    const { data: students } = await service
      .from("students")
      .select("id, class_id")
      .in("id", Array.from(studentClassPairs.keys()));
    if (!students || students.length !== studentClassPairs.size || students.some((student) => student.class_id !== studentClassPairs.get(student.id))) {
      return NextResponse.json({ error: "A score can only be saved for a student in the selected class." }, { status: 403 });
    }
  }

  // Validate score bounds for all records to guarantee data integrity
  for (const record of records) {
    if (record.cw !== undefined && record.cw !== null && (Number(record.cw) < 0 || Number(record.cw) > 10)) {
      return NextResponse.json({ error: `Classwork score (${record.cw}) exceeds the maximum allowed score of 10.` }, { status: 400 });
    }
    if (record.hw !== undefined && record.hw !== null && (Number(record.hw) < 0 || Number(record.hw) > 5)) {
      return NextResponse.json({ error: `Homework score (${record.hw}) exceeds the maximum allowed score of 5.` }, { status: 400 });
    }
    if (record.test !== undefined && record.test !== null && (Number(record.test) < 0 || Number(record.test) > 10)) {
      return NextResponse.json({ error: `Test score (${record.test}) exceeds the maximum allowed score of 10.` }, { status: 400 });
    }
    if (record.project !== undefined && record.project !== null && (Number(record.project) < 0 || Number(record.project) > 5)) {
      return NextResponse.json({ error: `Project score (${record.project}) exceeds the maximum allowed score of 5.` }, { status: 400 });
    }
    if (record.exam !== undefined && record.exam !== null && (Number(record.exam) < 0 || Number(record.exam) > 70)) {
      return NextResponse.json({ error: `Exam score (${record.exam}) exceeds the maximum allowed score of 70.` }, { status: 400 });
    }
    if (record.total !== undefined && record.total !== null && (Number(record.total) < 0 || Number(record.total) > 100)) {
      return NextResponse.json({ error: `Total score (${record.total}) exceeds the maximum allowed score of 100.` }, { status: 400 });
    }

    if (record.score_breakdown && typeof record.score_breakdown === "object") {
      const { valid, issues } = validateRawScores(record.score_breakdown);
      if (!valid && issues.length > 0) {
        const first = issues[0];
        return NextResponse.json(
          { error: `Score for ${first.field.toUpperCase()} item ${first.index + 1} (${first.value}) exceeds the maximum allowed score of ${first.max}.` },
          { status: 400 }
        );
      }
    }
  }

  // Only score fields are accepted from the client. Approval and publishing
  // status can only be changed by the admin endpoints.
  const cleanRecords = records.map((r: any) => ({
    student_id: r.student_id,
    subject_id: r.subject_id,
    class_id: r.class_id,
    term: r.term,
    session: r.session,
    ...(r.academic_session_id ? { academic_session_id: r.academic_session_id } : {}),
    cw: r.cw,
    hw: r.hw,
    test: r.test,
    project: r.project,
    exam: r.exam,
    // total is calculated by the database (cw + hw + test + project + exam)
    grade: r.grade,
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
    if (!optErr && optouts?.length) {
      const blocked = new Set(optouts.map((o: any) => `${o.student_id}:${o.subject_id}:${o.session}`));
      if (cleanRecords.some((r: any) => blocked.has(`${r.student_id}:${r.subject_id}:${r.session}`))) {
        return NextResponse.json(
          { error: "A student marked 'Not offering' for this subject cannot receive scores. Untick 'Not offering' first." },
          { status: 400 }
        );
      }
    }
  }

  if (deletedResultIds.length && actor.role !== "admin") {
    const { data: deletable } = await service
      .from("results")
      .select("id, class_id, subject_id, academic_session_id")
      .in("id", deletedResultIds);
    if (!deletable || deletable.length !== deletedResultIds.length) {
      return NextResponse.json({ error: "One or more result records could not be verified." }, { status: 403 });
    }
    for (const record of deletable) {
      if (!(await requireTeacherAssignment(actor, record.class_id, record.subject_id, record.academic_session_id))) {
        return NextResponse.json({ error: "You cannot delete results outside your assignment." }, { status: 403 });
      }
    }
  }

  // Check if term being saved is permitted for score editing
  const { data: settings } = await service
    .from("app_settings")
    .select("current_term, current_session")
    .limit(1)
    .maybeSingle();

  const currentTerm = settings?.current_term || "term1";

  for (const r of records) {
    const rTerm = r.term || currentTerm;
    const rSession = r.session || settings?.current_session || "";
    const canEdit = await isTermEditable(rSession, rTerm, service, currentTerm);
    if (!canEdit) {
      return NextResponse.json(
        {
          error: `Editing scores for ${rTerm} is locked. Administration permission is required to edit non-current terms.`,
        },
        { status: 403 }
      );
    }
  }

  try {
    if (deletedResultIds.length > 0) {
      const { error: delErr } = await service
        .from("results")
        .delete()
        .in("id", deletedResultIds);
      if (delErr) {
        console.warn("Could not delete dropped result IDs:", delErr);
      }
    }

    if (!cleanRecords.length) {
      return NextResponse.json({ ok: true, count: 0, deleted: deletedResultIds.length });
    }

    const { error } = await service
      .from("results")
      .upsert(cleanRecords, { onConflict: "student_id,subject_id,term,session" });

    if (error) {
      console.error("Save results DB error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
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
