import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const session = searchParams.get("session") || "";
  const type = searchParams.get("type"); // "class", "subject", or null for both

  try {
    let classAssignments: any[] = [];
    let subjectAssignments: any[] = [];

    if (!type || type === "class") {
      let query = service
        .from("class_teacher_assignments")
        .select(`
          id, academic_session_id, session, class_id, section_id, teacher_user_id,
          status, start_date, end_date, notes, created_at,
          classes(id, name),
          sections(id, name)
        `)
        .order("created_at", { ascending: false });

      if (session) {
        query = query.eq("session", session);
      }

      const { data, error } = await query;
      if (!error && data) {
        // Enrich with teacher names from users table
        const teacherIds = Array.from(new Set(data.map((d: any) => d.teacher_user_id)));
        let teacherMap = new Map<string, any>();
        if (teacherIds.length > 0) {
          const { data: teachers } = await service
            .from("users")
            .select("auth_id, display_name, email, staff_id")
            .in("auth_id", teacherIds);
          (teachers || []).forEach((t: any) => teacherMap.set(t.auth_id, t));
        }

        classAssignments = data.map((d: any) => ({
          ...d,
          teacher: teacherMap.get(d.teacher_user_id) || null,
        }));
      }
    }

    if (!type || type === "subject") {
      let query = service
        .from("subject_teacher_assignments")
        .select(`
          id, academic_session_id, session, class_id, section_id, subject_id, teacher_user_id,
          status, start_date, end_date, notes, created_at,
          classes(id, name),
          subjects(id, name),
          sections(id, name)
        `)
        .order("created_at", { ascending: false });

      if (session) {
        query = query.eq("session", session);
      }

      const { data, error } = await query;
      if (!error && data) {
        const teacherIds = Array.from(new Set(data.map((d: any) => d.teacher_user_id)));
        let teacherMap = new Map<string, any>();
        if (teacherIds.length > 0) {
          const { data: teachers } = await service
            .from("users")
            .select("auth_id, display_name, email, staff_id")
            .in("auth_id", teacherIds);
          (teachers || []).forEach((t: any) => teacherMap.set(t.auth_id, t));
        }

        subjectAssignments = data.map((d: any) => ({
          ...d,
          teacher: teacherMap.get(d.teacher_user_id) || null,
        }));
      }
    }

    return NextResponse.json({
      ok: true,
      classAssignments,
      subjectAssignments,
    });
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
    const {
      type, // "class" or "subject"
      sessionId,
      session,
      classId,
      sectionId = null,
      subjectId,
      teacherUserId,
      notes = "",
    } = body;

    if (!type || !session || !classId || !teacherUserId) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields (type, session, classId, teacherUserId)" },
        { status: 400 }
      );
    }

    // Resolve academic_session_id if not explicitly provided
    let effectiveSessionId = sessionId;
    if (!effectiveSessionId) {
      const { data: sessRow } = await service
        .from("academic_sessions")
        .select("id")
        .eq("name", session)
        .maybeSingle();
      effectiveSessionId = sessRow?.id;
    }

    if (!effectiveSessionId) {
      // Create session row if missing
      const { data: newSess } = await service
        .from("academic_sessions")
        .insert({ name: session, status: "active" })
        .select("id")
        .single();
      effectiveSessionId = newSess?.id;
    }

    const todayStr = new Date().toISOString().split("T")[0];

    if (type === "class") {
      // 1. Mark previous active class teacher as ended
      let endQuery = service
        .from("class_teacher_assignments")
        .update({ status: "ended", end_date: todayStr })
        .eq("academic_session_id", effectiveSessionId)
        .eq("class_id", classId)
        .eq("status", "active");

      if (sectionId) {
        endQuery = endQuery.eq("section_id", sectionId);
      } else {
        endQuery = endQuery.is("section_id", null);
      }
      await endQuery;

      // 2. Insert new active class teacher assignment
      const { data: newAssignment, error: insErr } = await service
        .from("class_teacher_assignments")
        .insert({
          academic_session_id: effectiveSessionId,
          session,
          class_id: classId,
          section_id: sectionId || null,
          teacher_user_id: teacherUserId,
          status: "active",
          start_date: todayStr,
          notes: notes || null,
        })
        .select("*")
        .single();

      if (insErr) {
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 400 });
      }

      // Backward compatibility: sync classes.class_teacher_id
      await service
        .from("classes")
        .update({ class_teacher_id: teacherUserId })
        .eq("id", classId);

      return NextResponse.json({ ok: true, assignment: newAssignment });
    } else if (type === "subject") {
      if (!subjectId) {
        return NextResponse.json(
          { ok: false, error: "subjectId is required for subject teacher assignment" },
          { status: 400 }
        );
      }

      // 1. Mark previous active subject teacher as ended
      let endQuery = service
        .from("subject_teacher_assignments")
        .update({ status: "ended", end_date: todayStr })
        .eq("academic_session_id", effectiveSessionId)
        .eq("class_id", classId)
        .eq("subject_id", subjectId)
        .eq("status", "active");

      if (sectionId) {
        endQuery = endQuery.eq("section_id", sectionId);
      } else {
        endQuery = endQuery.is("section_id", null);
      }
      await endQuery;

      // 2. Insert new active subject teacher assignment
      const { data: newAssignment, error: insErr } = await service
        .from("subject_teacher_assignments")
        .insert({
          academic_session_id: effectiveSessionId,
          session,
          class_id: classId,
          section_id: sectionId || null,
          subject_id: subjectId,
          teacher_user_id: teacherUserId,
          status: "active",
          start_date: todayStr,
          notes: notes || null,
        })
        .select("*")
        .single();

      if (insErr) {
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 400 });
      }

      // Backward compatibility: ensure teacher_assignments has this link
      await service
        .from("teacher_assignments")
        .upsert(
          {
            teacher_user_id: teacherUserId,
            class_id: classId,
            subject_id: subjectId,
          },
          { onConflict: "teacher_user_id,class_id,subject_id" }
        );

      return NextResponse.json({ ok: true, assignment: newAssignment });
    }

    return NextResponse.json({ ok: false, error: "Invalid assignment type" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
