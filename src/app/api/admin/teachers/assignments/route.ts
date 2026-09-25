import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

function extractSessionName(academicSessions: any, fallback: string = ""): string {
  if (Array.isArray(academicSessions)) {
    return academicSessions[0]?.name || fallback;
  }
  return academicSessions?.name || fallback;
}

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const { searchParams } = new URL(req.url);
  const session = searchParams.get("session") || "";
  const type = searchParams.get("type"); // "class", "subject", or null for both

  try {
    let classAssignments: any[] = [];
    let subjectAssignments: any[] = [];

    let targetSessionId: string | null = null;
    if (session) {
      const { data: sessRow } = await service
        .from("academic_sessions")
        .select("id")
        .eq("name", session)
        .maybeSingle();
      if (sessRow?.id) {
        targetSessionId = sessRow.id;
      }
    }

    if (!type || type === "class") {
      let query = service
        .from("class_teacher_assignments")
        .select(`
          id, academic_session_id, class_id, section_id, teacher_user_id,
          status, notes, assigned_at, ended_at,
          classes(id, name),
          sections(id, name),
          academic_sessions(id, name)
        `)
        .order("assigned_at", { ascending: false });

      if (targetSessionId) {
        query = query.eq("academic_session_id", targetSessionId);
      }

      const { data, error } = await query;
      if (!error && data) {
        // Enrich with teacher names from users table
        const teacherIds = Array.from(new Set(data.map((d: any) => d.teacher_user_id).filter(Boolean)));
        let teacherMap = new Map<string, any>();
        if (teacherIds.length > 0) {
          const { data: teachers } = await service
            .from("users")
            .select("id, auth_id, display_name, email, staff_id")
            .or(`id.in.(${teacherIds.join(",")}),auth_id.in.(${teacherIds.join(",")})`);
          (teachers || []).forEach((t: any) => {
            teacherMap.set(t.id, t);
            teacherMap.set(t.auth_id, t);
          });
        }

        classAssignments = data.map((d: any) => ({
          id: d.id,
          academic_session_id: d.academic_session_id,
          session: extractSessionName(d.academic_sessions, session),
          class_id: d.class_id,
          section_id: d.section_id,
          teacher_user_id: d.teacher_user_id,
          status: d.status,
          start_date: d.assigned_at ? d.assigned_at.split("T")[0] : "",
          end_date: d.ended_at ? d.ended_at.split("T")[0] : null,
          notes: d.notes,
          created_at: d.assigned_at,
          classes: d.classes,
          sections: d.sections,
          academic_sessions: d.academic_sessions,
          teacher: teacherMap.get(d.teacher_user_id) || null,
        }));
      }
    }

    if (!type || type === "subject") {
      let query = service
        .from("subject_teacher_assignments")
        .select(`
          id, academic_session_id, class_id, section_id, subject_id, teacher_user_id,
          status, notes, assigned_at, ended_at,
          classes(id, name),
          subjects(id, name),
          sections(id, name),
          academic_sessions(id, name)
        `)
        .order("assigned_at", { ascending: false });

      if (targetSessionId) {
        query = query.eq("academic_session_id", targetSessionId);
      }

      const { data, error } = await query;
      if (!error && data) {
        const teacherIds = Array.from(new Set(data.map((d: any) => d.teacher_user_id).filter(Boolean)));
        let teacherMap = new Map<string, any>();
        if (teacherIds.length > 0) {
          const { data: teachers } = await service
            .from("users")
            .select("id, auth_id, display_name, email, staff_id")
            .or(`id.in.(${teacherIds.join(",")}),auth_id.in.(${teacherIds.join(",")})`);
          (teachers || []).forEach((t: any) => {
            teacherMap.set(t.id, t);
            teacherMap.set(t.auth_id, t);
          });
        }

        subjectAssignments = data.map((d: any) => ({
          id: d.id,
          academic_session_id: d.academic_session_id,
          session: extractSessionName(d.academic_sessions, session),
          class_id: d.class_id,
          section_id: d.section_id,
          subject_id: d.subject_id,
          teacher_user_id: d.teacher_user_id,
          status: d.status,
          start_date: d.assigned_at ? d.assigned_at.split("T")[0] : "",
          end_date: d.ended_at ? d.ended_at.split("T")[0] : null,
          notes: d.notes,
          created_at: d.assigned_at,
          classes: d.classes,
          subjects: d.subjects,
          sections: d.sections,
          academic_sessions: d.academic_sessions,
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
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

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

    // Resolve teacher_user_id to public.users(id)
    let resolvedTeacherUserId = teacherUserId;
    const { data: userProfile } = await service
      .from("users")
      .select("id, auth_id")
      .or(`id.eq.${teacherUserId},auth_id.eq.${teacherUserId}`)
      .maybeSingle();

    if (userProfile?.id) {
      resolvedTeacherUserId = userProfile.id;
    }

    const nowIso = new Date().toISOString();
    const todayStr = nowIso.split("T")[0];

    if (type === "class") {
      const targetClassIds: string[] = Array.isArray(body.classIds) && body.classIds.length > 0 
        ? body.classIds 
        : [classId];

      const insertedList: any[] = [];

      for (const cid of targetClassIds) {
        // 1. Mark previous active class teacher as ended
        let endQuery = service
          .from("class_teacher_assignments")
          .update({ status: "ended", ended_at: nowIso })
          .eq("academic_session_id", effectiveSessionId)
          .eq("class_id", cid)
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
            class_id: cid,
            section_id: sectionId || null,
            teacher_user_id: resolvedTeacherUserId,
            status: "active",
            assigned_at: nowIso,
            notes: notes || null,
          })
          .select(`
            id, academic_session_id, class_id, section_id, teacher_user_id,
            status, notes, assigned_at, ended_at,
            classes(id, name),
            sections(id, name),
            academic_sessions(id, name)
          `)
          .single();

        if (insErr) {
          return NextResponse.json({ ok: false, error: insErr.message }, { status: 400 });
        }

        const rawClassAssignment: any = newAssignment;
        const formatted = {
          ...rawClassAssignment,
          session: extractSessionName(rawClassAssignment?.academic_sessions, session),
          start_date: rawClassAssignment?.assigned_at ? rawClassAssignment.assigned_at.split("T")[0] : todayStr,
          end_date: rawClassAssignment?.ended_at ? rawClassAssignment.ended_at.split("T")[0] : null,
          created_at: rawClassAssignment?.assigned_at,
        };

        insertedList.push(formatted);
      }

      return NextResponse.json({ ok: true, assignment: insertedList[0], assignments: insertedList });
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
        .update({ status: "ended", ended_at: nowIso })
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
          class_id: classId,
          section_id: sectionId || null,
          subject_id: subjectId,
          teacher_user_id: resolvedTeacherUserId,
          status: "active",
          assigned_at: nowIso,
          notes: notes || null,
        })
        .select(`
          id, academic_session_id, class_id, section_id, subject_id, teacher_user_id,
          status, notes, assigned_at, ended_at,
          classes(id, name),
          subjects(id, name),
          sections(id, name),
          academic_sessions(id, name)
        `)
        .single();

      if (insErr) {
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 400 });
      }

      const rawSubjectAssignment: any = newAssignment;
      const formatted = {
        ...rawSubjectAssignment,
        session: extractSessionName(rawSubjectAssignment?.academic_sessions, session),
        start_date: rawSubjectAssignment?.assigned_at ? rawSubjectAssignment.assigned_at.split("T")[0] : todayStr,
        end_date: rawSubjectAssignment?.ended_at ? rawSubjectAssignment.ended_at.split("T")[0] : null,
        created_at: rawSubjectAssignment?.assigned_at,
      };

      return NextResponse.json({ ok: true, assignment: formatted });
    }

    return NextResponse.json({ ok: false, error: "Invalid assignment type" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

/**
 * DELETE { type: "class" | "subject", ids: string[], mode: "unassign" | "delete" }
 * - unassign: ends the active assignment (kept in history, teacher loses access now)
 * - delete:   removes the assignment record completely (for test/mistaken entries)
 */
export async function DELETE(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const { type, mode } = body || {};
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  const table = type === "class" ? "class_teacher_assignments" : type === "subject" ? "subject_teacher_assignments" : null;
  if (!table || !ids.length || !["unassign", "delete"].includes(mode)) {
    return NextResponse.json({ ok: false, error: "type, ids and mode are required." }, { status: 400 });
  }

  const { error } =
    mode === "unassign"
      ? await service.from(table).update({ status: "ended", ended_at: new Date().toISOString() }).in("id", ids).eq("status", "active")
      : await service.from(table).delete().in("id", ids);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
