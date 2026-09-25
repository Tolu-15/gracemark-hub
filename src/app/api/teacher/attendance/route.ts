import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("class_id");
  const term = searchParams.get("term") || "term1";
  let session = searchParams.get("session");
  const date = searchParams.get("date");

  if (!classId) {
    return NextResponse.json({ error: "class_id is required." }, { status: 400 });
  }

  try {
    let academicSessionId: string | null = null;
    if (!session) {
      const { data: activeSess } = await service
        .from("academic_sessions")
        .select("id, name")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      session = activeSess?.name || "2026/2027";
      academicSessionId = activeSess?.id || null;
    } else {
      const { data: sessRow } = await service
        .from("academic_sessions")
        .select("id")
        .eq("name", session)
        .limit(1)
        .maybeSingle();
      academicSessionId = sessRow?.id || null;
    }

    // 1. Fetch students enrolled in this class for this session
    let students: any[] = [];
    let enrollQuery = service
      .from("student_enrollments")
      .select("student_id, students(id, name, admission_no)")
      .eq("class_id", classId)
      .eq("status", "active");

    if (academicSessionId) {
      enrollQuery = enrollQuery.eq("academic_session_id", academicSessionId);
    } else if (session) {
      enrollQuery = enrollQuery.eq("session", session);
    }

    const { data: enrollments } = await enrollQuery;

    if (enrollments && enrollments.length > 0) {
      students = enrollments
        .map((e: any) => e.students)
        .filter(Boolean)
        .sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
    }

    if (!students.length) {
      const { data: stdList } = await service
        .from("students")
        .select("id, name, admission_no")
        .eq("class_id", classId)
        .order("name", { ascending: true });
      students = stdList || [];
    }

    const sIds = students.map((s) => s.id);
    if (!sIds.length) {
      return NextResponse.json({ ok: true, students: [] });
    }

    // 2. Fetch daily register for date (if provided)
    let dailyRecordsMap: Record<string, { am: boolean; pm: boolean }> = {};
    if (date) {
      const { data: dRecs } = await service
        .from("attendance_records")
        .select("student_id, am_present, pm_present")
        .in("student_id", sIds)
        .eq("term", term)
        .eq("session", session)
        .eq("date", date);

      (dRecs || []).forEach((r) => {
        dailyRecordsMap[r.student_id] = {
          am: r.am_present ?? true,
          pm: r.pm_present ?? true,
        };
      });
    }

    // 3. Fetch cumulative daily register counts across the term for each student
    const { data: allDaily } = await service
      .from("attendance_records")
      .select("student_id, am_present, pm_present, date")
      .in("student_id", sIds)
      .eq("term", term)
      .eq("session", session);

    const dailyCountsMap: Record<string, { present: number; recorded: number }> = {};
    const datesSet = new Set<string>();

    (allDaily || []).forEach((r) => {
      datesSet.add(r.date);
      if (!dailyCountsMap[r.student_id]) {
        dailyCountsMap[r.student_id] = { present: 0, recorded: 0 };
      }
      dailyCountsMap[r.student_id].recorded += 1;
      if (r.am_present && r.pm_present) {
        dailyCountsMap[r.student_id].present += 1;
      }
    });

    const totalSchoolDaysRecorded = datesSet.size;

    // 4. Fetch term summary attendance scoped strictly to this session and term
    let termQuery = service
      .from("attendance")
      .select("student_id, times_present, times_opened, times_absent")
      .in("student_id", sIds)
      .eq("term", term);

    if (academicSessionId) {
      termQuery = termQuery.or(`academic_session_id.eq.${academicSessionId},session.eq.${session}`);
    } else if (session) {
      termQuery = termQuery.eq("session", session);
    }

    const { data: termData } = await termQuery;

    const termSummaryMap: Record<string, { times_present: number; times_opened: number; times_absent: number }> = {};
    (termData || []).forEach((t) => {
      termSummaryMap[t.student_id] = {
        times_present: t.times_present ?? 0,
        times_opened: t.times_opened ?? (totalSchoolDaysRecorded || 120),
        times_absent: t.times_absent ?? 0,
      };
    });

    // 5. Build merged student attendance list with 120 default
    const defaultTimesOpened = 120;

    const result = students.map((s) => {
      const daily = dailyRecordsMap[s.id];
      const termRec = termSummaryMap[s.id];
      const dailyAgg = dailyCountsMap[s.id];

      const timesOpened = termRec?.times_opened || (totalSchoolDaysRecorded > 0 ? totalSchoolDaysRecorded : defaultTimesOpened);
      const timesPresent = termRec?.times_present ?? (dailyAgg && dailyAgg.recorded > 0 ? dailyAgg.present : 0);
      const timesAbsent = Math.max(0, timesOpened - timesPresent);

      return {
        student_id: s.id,
        name: s.name,
        admission_no: s.admission_no,
        am: daily ? daily.am : true,
        pm: daily ? daily.pm : true,
        timesPresent,
        timesOpened,
        timesAbsent,
        hasDailyRecords: Boolean(dailyAgg && dailyAgg.recorded > 0),
        dailyPresentCount: dailyAgg?.present ?? 0,
      };
    });

    return NextResponse.json({
      ok: true,
      students: result,
      totalSessionsRecorded: totalSchoolDaysRecorded,
      datesCount: datesSet.size,
    });
  } catch (err: any) {
    console.error("GET /api/teacher/attendance error:", err);
    return NextResponse.json({ error: err.message || "Failed to load attendance." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { action, records = [], term, session, class_id } = body;

  try {
    if (action === "save_daily") {
      if (!records.length) {
        return NextResponse.json({ error: "No daily attendance records provided." }, { status: 400 });
      }

      // 1. Upsert daily records into attendance_records with service role client (bypasses RLS)
      const cleanRecords = records.map((r: any) => ({
        student_id: r.student_id,
        class_id: r.class_id || class_id,
        term: r.term || term,
        session: r.session || session,
        date: r.date,
        am_present: Boolean(r.am_present),
        pm_present: Boolean(r.pm_present),
        recorded_by: r.recorded_by || null,
      }));

      const { error: dailyErr } = await service
        .from("attendance_records")
        .upsert(cleanRecords, { onConflict: "student_id,term,session,date" });

      if (dailyErr) {
        console.error("attendance_records upsert error:", dailyErr);
        throw dailyErr;
      }

      // 2. Automatically sync cumulative daily register counts to the attendance table!
      const studentIds: string[] = Array.from(new Set(cleanRecords.map((r: any) => String(r.student_id))));
      const activeTerm = cleanRecords[0]?.term || term;
      const activeSession = cleanRecords[0]?.session || session;

      const { data: allStudentRecords } = await service
        .from("attendance_records")
        .select("student_id, am_present, pm_present, date")
        .in("student_id", studentIds)
        .eq("term", activeTerm)
        .eq("session", activeSession);

      const syncMap: Record<string, number> = {};
      const datesSet = new Set<string>();

      (allStudentRecords || []).forEach((r: any) => {
        datesSet.add(r.date);
        // A school day counts as 1. If a student misses morning OR afternoon, it counts as 0 (absent).
        if (r.am_present && r.pm_present) {
          syncMap[r.student_id] = (syncMap[r.student_id] || 0) + 1;
        }
      });

      const totalRecordedTimes = Math.max(120, datesSet.size);

      // Resolve academic_session_id for session
      let academicSessionId: string | null = null;
      try {
        const { data: sessRow } = await service
          .from("academic_sessions")
          .select("id")
          .eq("name", activeSession)
          .limit(1)
          .maybeSingle();
        academicSessionId = sessRow?.id || null;
      } catch {}

      const summaryPayload = studentIds.map((sId: string) => {
        const present = syncMap[sId] || 0;
        return {
          student_id: sId,
          class_id: cleanRecords[0]?.class_id || class_id,
          term: activeTerm,
          session: activeSession,
          academic_session_id: academicSessionId || undefined,
          times_opened: totalRecordedTimes,
          times_present: present,
          times_absent: Math.max(0, totalRecordedTimes - present),
          recorded_by: cleanRecords[0]?.recorded_by || null,
        };
      });

      let { error: summarySyncErr } = await service
        .from("attendance")
        .upsert(summaryPayload, { onConflict: "student_id,term,session" });

      if (summarySyncErr && /constraint/i.test(summarySyncErr.message)) {
        const fallback = await service
          .from("attendance")
          .upsert(summaryPayload, { onConflict: "student_id,term" });
        summarySyncErr = fallback.error;
      }

      if (summarySyncErr) {
        console.warn("Auto-sync to attendance table warning:", summarySyncErr);
      }

      return NextResponse.json({
        ok: true,
        message: `Daily register saved and synced for ${records.length} students!`,
        count: records.length,
      });
    }

    if (action === "save_summary") {
      if (!records.length) {
        return NextResponse.json({ error: "No summary records provided." }, { status: 400 });
      }

      const activeSession = records[0]?.session || session;
      let academicSessionId: string | null = null;
      try {
        const { data: sessRow } = await service
          .from("academic_sessions")
          .select("id")
          .eq("name", activeSession)
          .limit(1)
          .maybeSingle();
        academicSessionId = sessRow?.id || null;
      } catch {}

      const summaryPayload = records.map((r: any) => {
        const opened = Math.max(0, Number(r.times_opened) || 120);
        const present = Math.min(opened, Math.max(0, Number(r.times_present) || 0));
        const absent = Math.max(0, opened - present);

        return {
          student_id: r.student_id,
          class_id: r.class_id || class_id,
          term: r.term || term,
          session: r.session || activeSession,
          academic_session_id: academicSessionId || undefined,
          times_opened: opened,
          times_present: present,
          times_absent: absent,
          recorded_by: r.recorded_by || null,
        };
      });

      let { error: sumErr } = await service
        .from("attendance")
        .upsert(summaryPayload, { onConflict: "student_id,term,session" });

      if (sumErr && /constraint/i.test(sumErr.message)) {
        const fallback = await service
          .from("attendance")
          .upsert(summaryPayload, { onConflict: "student_id,term" });
        sumErr = fallback.error;
      }

      if (sumErr) {
        console.error("attendance summary upsert error:", sumErr);
        throw sumErr;
      }

      return NextResponse.json({
        ok: true,
        message: `Term attendance summary saved for ${records.length} students!`,
        count: records.length,
      });
    }

    return NextResponse.json({ error: "Unknown action provided." }, { status: 400 });
  } catch (err: any) {
    console.error("POST /api/teacher/attendance error:", err);
    return NextResponse.json({ error: err.message || "Failed to save attendance." }, { status: 500 });
  }
}
