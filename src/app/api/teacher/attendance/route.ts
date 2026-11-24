import { NextRequest, NextResponse } from "next/server";
import { canManageClass, requireApiActor, ApiActor } from "@/lib/apiAuth";

const DEFAULT_SCHOOL_DAYS = 120;

type Service = ApiActor["service"];

/** Resolves the academic session row by name, falling back to the active session. */
async function resolveSession(service: Service, name?: string | null) {
  if (name) {
    const { data } = await service
      .from("academic_sessions")
      .select("id, name, is_current")
      .eq("name", name)
      .limit(1)
      .maybeSingle();
    return data?.id ? data : null;
  }
  const { data: active } = await service
    .from("academic_sessions")
    .select("id, name, is_current")
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
  return active?.id ? active : null;
}

/**
 * Active enrollments (one per student) for a class in a session.
 *
 * The class roster itself comes from students.class_id — the same source every
 * other page (score entry, gradebook, etc.) uses — rather than from
 * student_enrollments alone. Admin > Students (both "Add Student" and bulk
 * import) only ever writes students.class_id and never creates a
 * student_enrollments row, so a class teacher's own class could otherwise show
 * zero students here even though every other page saw the full roster. Any
 * student on the roster with no enrollment row yet for this session gets one
 * created on the fly; a student with an existing but non-active row (withdrawn,
 * transferred) is left alone and excluded, same as before.
 */
async function loadEnrollments(service: Service, classId: string, sessionId: string, current: boolean) {
  if (!current) {
    const { data, error } = await service.from("student_enrollments")
      .select("id, student_id, students(name, full_name, admission_no)")
      .eq("class_id", classId).eq("academic_session_id", sessionId);
    if (error) throw error;
    return (data || []).map((e: any) => ({ enrollmentId: e.id as string, studentId: e.student_id as string,
      name: String(e.students?.full_name || e.students?.name || ""), admissionNo: String(e.students?.admission_no || "") }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const { data: classStudents, error: csErr } = await service
    .from("students")
    .select("id, full_name, name, admission_no")
    .eq("class_id", classId);
  if (csErr) throw csErr;
  if (!classStudents?.length) return [];

  const studentIds = classStudents.map((s: any) => s.id);
  const { data: existingEnrollments, error: eErr } = await service
    .from("student_enrollments")
    .select("id, student_id, status, class_id")
    .eq("academic_session_id", sessionId)
    .in("student_id", studentIds);
  if (eErr) throw eErr;

  const byStudent = new Map<string, { id: string; status: string }>(
    (existingEnrollments || []).map((e: any) => [e.student_id, { id: e.id, status: e.class_id === classId ? e.status : "other class" }])
  );

  const toCreate = classStudents.filter((s: any) => !byStudent.has(s.id));
  if (toCreate.length) {
    const { data: created, error: insErr } = await service
      .from("student_enrollments")
      .insert(
        toCreate.map((s: any) => ({
          student_id: s.id,
          academic_session_id: sessionId,
          class_id: classId,
          status: "active",
        }))
      )
      .select("id, student_id");
    if (insErr) console.warn("Could not back-fill missing student_enrollments:", insErr);
    (created || []).forEach((c: any) => byStudent.set(c.student_id, { id: c.id, status: "active" }));
  }

  return classStudents
    .filter((s: any) => byStudent.get(s.id)?.status === "active")
    .map((s: any) => {
      const e = byStudent.get(s.id)!;
      return {
        enrollmentId: e.id,
        studentId: s.id as string,
        name: (s.full_name || s.name || "") as string,
        admissionNo: (s.admission_no || "") as string,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("class_id");
  const term = searchParams.get("term") || "term1";
  const date = searchParams.get("date");

  if (!classId) {
    return NextResponse.json({ error: "class_id is required." }, { status: 400 });
  }

  try {
    const session = await resolveSession(service, searchParams.get("session"));
    if (!session) {
      return NextResponse.json({ ok: true, students: [] });
    }

    if (!(await canManageClass(authorization.actor, classId, session.id))) {
      return NextResponse.json({ error: "Class teacher access required." }, { status: 403 });
    }
    const { data: termConfig, error: termError } = await service.from("academic_terms")
      .select("school_days,school_days_managed").eq("academic_session_id", session.id).eq("term_code", term).maybeSingle();
    if (termError) throw termError;
    const managedDays = termConfig?.school_days_managed ? Number(termConfig.school_days) : null;
    const roster = await loadEnrollments(service, classId, session.id, session.is_current);
    if (!roster.length) {
      return NextResponse.json({ ok: true, students: [] });
    }
    const enrollmentIds = roster.map((r) => r.enrollmentId);

    // Daily register rows for the whole term (cumulative counts + the selected date)
    const { data: dailyRows, error: dailyErr } = await service
      .from("attendance_records")
      .select("enrollment_id, am_present, pm_present, date")
      .in("enrollment_id", enrollmentIds)
      .eq("term", term);
    if (dailyErr) throw dailyErr;

    const dayMap: Record<string, { am: boolean; pm: boolean }> = {};
    const counts: Record<string, { present: number; recorded: number }> = {};
    const dates = new Set<string>();

    (dailyRows || []).forEach((r: any) => {
      dates.add(r.date);
      const c = (counts[r.enrollment_id] ||= { present: 0, recorded: 0 });
      c.recorded += 1;
      if (r.am_present && r.pm_present) c.present += 1;
      if (date && r.date === date) {
        dayMap[r.enrollment_id] = { am: r.am_present ?? true, pm: r.pm_present ?? true };
      }
    });

    const { data: summaries, error: sumErr } = await service
      .from("attendance_summaries")
      .select("enrollment_id, times_present, times_opened, times_absent")
      .in("enrollment_id", enrollmentIds)
      .eq("term", term);
    if (sumErr) throw sumErr;

    const summaryMap: Record<string, any> = {};
    (summaries || []).forEach((s: any) => (summaryMap[s.enrollment_id] = s));

    const students = roster.map((r) => {
      const daily = dayMap[r.enrollmentId];
      const summary = summaryMap[r.enrollmentId];
      const agg = counts[r.enrollmentId];

      const timesOpened = managedDays ?? (summary?.times_opened || termConfig?.school_days || dates.size || DEFAULT_SCHOOL_DAYS);
      const timesPresent = summary?.times_present ?? (agg?.recorded ? agg.present : 0);

      return {
        student_id: r.studentId,
        name: r.name,
        admission_no: r.admissionNo,
        am: daily ? daily.am : true,
        pm: daily ? daily.pm : true,
        timesPresent,
        timesOpened,
        timesAbsent: Math.max(0, timesOpened - timesPresent),
        hasDailyRecords: Boolean(agg?.recorded),
        dailyPresentCount: agg?.present ?? 0,
      };
    });

    return NextResponse.json({
      ok: true,
      students,
      managedDays,
      totalSessionsRecorded: dates.size,
      datesCount: dates.size,
    });
  } catch (err: any) {
    console.error("GET /api/teacher/attendance error:", err);
    return NextResponse.json({ error: err.message || "Failed to load attendance." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service, dbUserId } = actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { action, records = [], term, session, class_id } = body;

  if (action !== "save_daily" && action !== "save_summary") {
    return NextResponse.json({ error: "Unknown action provided." }, { status: 400 });
  }
  if (!Array.isArray(records) || !records.length) {
    return NextResponse.json({ error: "No attendance records provided." }, { status: 400 });
  }
  if (!dbUserId) {
    return NextResponse.json({ error: "Your staff profile could not be resolved." }, { status: 403 });
  }

  try {
    const activeTerm = records[0]?.term || term;
    const classId = records[0]?.class_id || class_id;
    if (!activeTerm || !classId) {
      return NextResponse.json({ error: "term and class_id are required." }, { status: 400 });
    }

    const sess = await resolveSession(service, records[0]?.session || session);
    if (!sess) {
      return NextResponse.json({ error: "No academic session found." }, { status: 400 });
    }

    if (!(await canManageClass(authorization.actor, classId, sess.id))) {
      return NextResponse.json({ error: "Class teacher access required." }, { status: 403 });
    }
    const roster = await loadEnrollments(service, classId, sess.id, sess.is_current);
    const enrollmentByStudent = new Map(roster.map((r) => [r.studentId, r.enrollmentId]));

    const rows = records
      .map((r: any) => ({ record: r, enrollmentId: enrollmentByStudent.get(r.student_id) }))
      .filter((r: any) => r.enrollmentId);
    if (rows.length !== records.length) {
      return NextResponse.json(
        { error: "Every student must belong to this class for the selected session." },
        { status: 400 }
      );
    }


    if (action === "save_daily") {
      const daily = rows.map(({ record, enrollmentId }: any) => ({
        enrollment_id: enrollmentId,
        term: activeTerm,
        date: record.date,
        am_present: Boolean(record.am_present),
        pm_present: Boolean(record.pm_present),
        recorded_by: dbUserId,
      }));

      const { error: dailyErr } = await service
        .from("attendance_records")
        .upsert(daily, { onConflict: "enrollment_id,date" });
      if (dailyErr) throw dailyErr;

      // The attendance_records trigger updates the summary in this same transaction.
      return NextResponse.json({
        ok: true,
        message: `Daily register saved and synced for ${rows.length} students!`,
        count: rows.length,
      });
    }

    const { data: config, error: configError } = await service.from("academic_terms")
      .select("school_days,school_days_managed").eq("academic_session_id", sess.id).eq("term_code", activeTerm).maybeSingle();
    if (configError) throw configError;
    if (config?.school_days_managed && rows.some(({ record }: any) => Number(record.times_opened) !== config.school_days)) {
      return NextResponse.json({ error: "The admin changed school days. Reload attendance before saving." }, { status: 409 });
    }
    const summaries = rows.map(({ record, enrollmentId }: any) => {
      const opened = Math.max(0, Number(record.times_opened) || DEFAULT_SCHOOL_DAYS);
      const present = Math.min(opened, Math.max(0, Number(record.times_present) || 0));
      return {
        enrollment_id: enrollmentId,
        term: activeTerm,
        times_opened: opened,
        times_present: present,
        times_absent: opened - present,
        updated_at: new Date().toISOString(),
      };
    });

    const { error: sumErr } = await service
      .from("attendance_summaries")
      .upsert(summaries, { onConflict: "enrollment_id,term" });
    if (sumErr) throw sumErr;

    return NextResponse.json({
      ok: true,
      message: `Term attendance summary saved for ${rows.length} students!`,
      count: rows.length,
    });
  } catch (err: any) {
    console.error("POST /api/teacher/attendance error:", err);
    return NextResponse.json({ error: err.message || "Failed to save attendance." }, { status: 500 });
  }
}
