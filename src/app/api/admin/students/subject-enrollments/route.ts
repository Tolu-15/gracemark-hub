import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { STANDARD_JSS_SUBJECTS, getSSSTrackDefaults, isJuniorClass } from "@/lib/curriculum";

export async function GET(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get("studentId");
  const classId = searchParams.get("classId");
  const sessionId = searchParams.get("sessionId");
  const session = searchParams.get("session");

  try {
    let query = service
      .from("student_subject_enrollments")
      .select(`
        id, subject_id, enrollment_id,
        status, enrolled_at, dropped_at,
        subjects (id, name),
        student_enrollments!inner (
          id,
          student_id,
          class_id,
          academic_session_id,
          students (id, name, admission_no),
          classes (id, name),
          academic_sessions (id, name)
        )
      `)
      .order("enrolled_at", { ascending: true });

    if (studentId) query = query.eq("student_enrollments.student_id", studentId);
    if (classId) query = query.eq("student_enrollments.class_id", classId);
    if (sessionId) query = query.eq("student_enrollments.academic_session_id", sessionId);
    if (session) query = query.eq("student_enrollments.academic_sessions.name", session);

    const { data, error } = await query;
    if (error) throw error;

    const enrollments = (data || []).map((d: any) => ({
      id: d.id,
      student_id: d.student_enrollments?.student_id || d.student_id,
      subject_id: d.subject_id,
      academic_session_id: d.student_enrollments?.academic_session_id || d.academic_session_id,
      session: d.student_enrollments?.academic_sessions?.name || d.session || "",
      class_id: d.student_enrollments?.class_id || d.class_id,
      enrollment_id: d.enrollment_id,
      status: d.status,
      is_active: d.status === "enrolled",
      dropped_at: d.dropped_at,
      created_at: d.enrolled_at,
      subjects: d.subjects,
      students: d.student_enrollments?.students || d.students,
      classes: d.student_enrollments?.classes || d.classes,
    }));

    return NextResponse.json({ ok: true, enrollments });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    // Helper to resolve session ID & name
    let academicSessionId = body.academicSessionId || body.sessionId;
    let sessionName = body.session || "";

    if (!academicSessionId && sessionName) {
      const { data: sessRow } = await service
        .from("academic_sessions")
        .select("id, name")
        .eq("name", sessionName)
        .maybeSingle();
      if (sessRow) {
        academicSessionId = sessRow.id;
      }
    } else if (academicSessionId && !sessionName) {
      const { data: sessRow } = await service
        .from("academic_sessions")
        .select("id, name")
        .eq("id", academicSessionId)
        .maybeSingle();
      if (sessRow) {
        sessionName = sessRow.name;
      }
    }

    if (!academicSessionId) {
      const { data: activeSess } = await service
        .from("academic_sessions")
        .select("id, name")
        .eq("status", "active")
        .maybeSingle();
      if (activeSess) {
        academicSessionId = activeSess.id;
        sessionName = sessionName || activeSess.name;
      }
    }

    // ACTION 1: Batch auto-enroll JSS class into standard curriculum
    if (action === "auto-enroll-jss") {
      const { classId } = body;
      if (!classId) {
        return NextResponse.json({ ok: false, error: "classId is required" }, { status: 400 });
      }

      // 1. Fetch class info to verify it is JSS
      const { data: cls } = await service.from("classes").select("id, name").eq("id", classId).single();
      if (!cls || !isJuniorClass(cls.name)) {
        return NextResponse.json(
          { ok: false, error: "The selected class is not a Junior Secondary class." },
          { status: 400 }
        );
      }

      // 2. Fetch all students in this class (from student_enrollments or students)
      let studentsInClass: string[] = [];
      if (academicSessionId) {
        const { data: enrollments } = await service
          .from("student_enrollments")
          .select("student_id")
          .eq("class_id", classId)
          .eq("academic_session_id", academicSessionId)
          .eq("status", "active");
        if (enrollments && enrollments.length > 0) {
          studentsInClass = enrollments.map((e: any) => e.student_id);
        }
      }
      if (!studentsInClass.length) {
        const { data: stds } = await service.from("students").select("id").eq("class_id", classId);
        studentsInClass = (stds || []).map((s: any) => s.id);
      }

      if (!studentsInClass.length) {
        return NextResponse.json({ ok: false, error: "No students found in this class." }, { status: 400 });
      }

      // 3. Fetch subject IDs matching STANDARD_JSS_SUBJECTS
      const { data: allSubjects } = await service.from("subjects").select("id, name");
      const standardSubjectMap = new Map<string, string>();
      (allSubjects || []).forEach((s) => {
        standardSubjectMap.set(s.name.trim().toLowerCase(), s.id);
      });

      const matchedSubjectIds: string[] = [];
      STANDARD_JSS_SUBJECTS.forEach((subName) => {
        const id = standardSubjectMap.get(subName.toLowerCase());
        if (id) matchedSubjectIds.push(id);
      });

      if (!matchedSubjectIds.length) {
        return NextResponse.json(
          { ok: false, error: "Standard JSS subjects were not found in the subjects catalog." },
          { status: 400 }
        );
      }

      // 4. Upsert enrollments for every student
      const rowsToInsert: any[] = [];
      for (const sId of studentsInClass) {
        for (const subId of matchedSubjectIds) {
          rowsToInsert.push({
            student_id: sId,
            subject_id: subId,
            academic_session_id: academicSessionId,
            session: sessionName,
            class_id: classId,
            status: "enrolled",
            is_active: true,
          });
        }
      }

      // Batch upsert in chunks of 100
      for (let i = 0; i < rowsToInsert.length; i += 100) {
        const chunk = rowsToInsert.slice(i, i + 100);
        await service.from("student_subject_enrollments").upsert(chunk, {
          onConflict: "student_id,subject_id,academic_session_id",
          ignoreDuplicates: false,
        });
      }

      return NextResponse.json({
        ok: true,
        enrolledStudentsCount: studentsInClass.length,
        subjectsCount: matchedSubjectIds.length,
        message: `Successfully enrolled ${studentsInClass.length} students into ${matchedSubjectIds.length} standard JSS subjects.`,
      });
    }

    // ACTION 2: Save individual student subject enrollments (SSS or custom JSS overrides)
    if (action === "save-student-subjects") {
      const { studentId, classId, subjectStatuses } = body;
      // subjectStatuses: Record<string, { status: "enrolled" | "dropped" | "exempted" }>
      if (!studentId || !subjectStatuses) {
        return NextResponse.json({ ok: false, error: "studentId and subjectStatuses required" }, { status: 400 });
      }

      const todayStr = new Date().toISOString();
      const entries = Object.entries(subjectStatuses) as [string, { status: "enrolled" | "dropped" | "exempted"; notes?: string }][];

      const upsertRows = entries.map(([subId, cfg]) => ({
        student_id: studentId,
        subject_id: subId,
        academic_session_id: academicSessionId,
        session: sessionName,
        class_id: classId || null,
        status: cfg.status,
        is_active: cfg.status === "enrolled",
        dropped_at: cfg.status === "dropped" ? todayStr : null,
        notes: cfg.notes || null,
        updated_at: todayStr,
      }));

      if (upsertRows.length > 0) {
        const { error: upsertErr } = await service
          .from("student_subject_enrollments")
          .upsert(upsertRows, {
            onConflict: "student_id,subject_id,academic_session_id",
          });
        if (upsertErr) throw upsertErr;
      }

      return NextResponse.json({ ok: true, count: upsertRows.length });
    }

    // ACTION 3: Prepopulate track defaults for SSS student
    if (action === "get-track-defaults") {
      const { className } = body;
      const defaults = getSSSTrackDefaults(className);
      const { data: allSubjects } = await service.from("subjects").select("id, name");
      const nameMap = new Map<string, string>();
      (allSubjects || []).forEach((s) => nameMap.set(s.name.trim().toLowerCase(), s.id));

      const resolveIds = (names: string[]) =>
        names
          .map((n) => ({ id: nameMap.get(n.toLowerCase()), name: n }))
          .filter((item): item is { id: string; name: string } => Boolean(item.id));

      return NextResponse.json({
        ok: true,
        core: resolveIds(defaults.core),
        majors: resolveIds(defaults.majors),
        electives: resolveIds(defaults.electives),
      });
    }

    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("Subject enrollment API error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
