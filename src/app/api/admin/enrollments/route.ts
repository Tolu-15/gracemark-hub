import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get("student_id");
  const session = searchParams.get("session");
  const classId = searchParams.get("class_id");

  try {
    let query = service
      .from("student_enrollments")
      .select(`
        id, student_id, academic_session_id, session, class_id, section_id,
        status, enrolled_at, created_at,
        classes(id, name),
        sections(id, name),
        students(id, admission_no, name, user_id, portal_access_status)
      `)
      .order("created_at", { ascending: true });

    if (studentId) query = query.eq("student_id", studentId);
    if (session) query = query.eq("session", session);
    if (classId) query = query.eq("class_id", classId);

    const { data, error } = await query;
    if (error) {
      // If table student_enrollments is empty or not yet migrated, fallback gracefully
      return NextResponse.json({ ok: true, enrollments: [] });
    }

    return NextResponse.json({ ok: true, enrollments: data || [] });
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
    const { studentId, sessionId, session, classId, sectionId, status = "active" } = body;

    if (!studentId || !session || !classId) {
      return NextResponse.json(
        { ok: false, error: "studentId, session, and classId are required." },
        { status: 400 }
      );
    }

    let effectiveSessionId = sessionId;
    if (!effectiveSessionId) {
      const { data: sRow } = await service
        .from("academic_sessions")
        .select("id")
        .eq("name", session)
        .maybeSingle();
      effectiveSessionId = sRow?.id;
    }

    if (!effectiveSessionId) {
      const { data: newS } = await service
        .from("academic_sessions")
        .insert({ name: session, status: "active" })
        .select("id")
        .single();
      effectiveSessionId = newS?.id;
    }

    const { data: enrollment, error } = await service
      .from("student_enrollments")
      .upsert(
        {
          student_id: studentId,
          academic_session_id: effectiveSessionId,
          session,
          class_id: classId,
          section_id: sectionId || null,
          status,
        },
        { onConflict: "student_id,academic_session_id" }
      )
      .select("*")
      .single();

    if (error) throw error;

    // Update students.class_id cache for the active session
    await service.from("students").update({ class_id: classId }).eq("id", studentId);

    return NextResponse.json({ ok: true, enrollment });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
