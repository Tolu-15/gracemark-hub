import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, ApiActor } from "@/lib/apiAuth";

const DEFAULT_SCHOOL_DAYS = 120;

type Service = ApiActor["service"];

/** Resolves the academic session row by name, falling back to the active session. */
async function resolveSession(service: Service, name?: string | null) {
  if (name) {
    const { data } = await service
      .from("academic_sessions")
      .select("id, name")
      .eq("name", name)
      .limit(1)
      .maybeSingle();
    if (data?.id) return { id: data.id as string, name: data.name as string };
  }
  const { data: active } = await service
    .from("academic_sessions")
    .select("id, name")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return active?.id ? { id: active.id as string, name: active.name as string } : null;
}

/** Active enrollments (one per student) for a class in a session. */
async function loadEnrollments(service: Service, classId: string, sessionId: string) {
  const { data, error } = await service
    .from("student_enrollments")
    .select("id, student_id, students(*)")
    .eq("class_id", classId)
    .eq("academic_session_id", sessionId)
    .eq("status", "active");
  if (error) throw error;

  return (data || [])
    .map((e: any) => {
      const s = Array.isArray(e.students) ? e.students[0] : e.students;
      return {
        enrollmentId: e.id as string,
        studentId: e.student_id as string,
        name: (s?.full_name || s?.name || "") as string,
        admissionNo: (s?.admission_no || "") as string,
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

    const roster = await loadEnrollments(service, classId, session.id);
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

      const timesOpened = summary?.times_opened || (dates.size > 0 ? dates.size : DEFAULT_SCHOOL_DAYS);
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
  const { service, dbUserId } = authorization.actor;

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

    const roster = await loadEnrollments(service, classId, sess.id);
    const enrollmentByStudent = new Map(roster.map((r) => [r.studentId, r.enrollmentId]));

    const rows = records
      .map((r: any) => ({ record: r, enrollmentId: enrollmentByStudent.get(r.student_id) }))
      .filter((r: any) => r.enrollmentId);
    if (!rows.length) {
      return NextResponse.json(
        { error: "None of these students are enrolled in this class for the selected session." },
        { status: 400 }
      );
    }
    const enrollmentIds: string[] = rows.map((r: any) => r.enrollmentId);

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

      // Keep the term summary in step with the daily register.
      const { data: allRecords, error: allErr } = await service
        .from("attendance_records")
        .select("enrollment_id, am_present, pm_present, date")
        .in("enrollment_id", enrollmentIds)
        .eq("term", activeTerm);
      if (allErr) throw allErr;

      const presentBy: Record<string, number> = {};
      const dates = new Set<string>();
      (allRecords || []).forEach((r: any) => {
        dates.add(r.date);
        if (r.am_present && r.pm_present) presentBy[r.enrollment_id] = (presentBy[r.enrollment_id] || 0) + 1;
      });
      const opened = Math.max(DEFAULT_SCHOOL_DAYS, dates.size);

      const summaries = enrollmentIds.map((id) => {
        const present = presentBy[id] || 0;
        return {
          enrollment_id: id,
          term: activeTerm,
          times_opened: opened,
          times_present: present,
          times_absent: Math.max(0, opened - present),
          updated_at: new Date().toISOString(),
        };
      });
      const { error: summaryErr } = await service
        .from("attendance_summaries")
        .upsert(summaries, { onConflict: "enrollment_id,term" });
      if (summaryErr) throw summaryErr;

      return NextResponse.json({
        ok: true,
        message: `Daily register saved and synced for ${rows.length} students!`,
        count: rows.length,
      });
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
