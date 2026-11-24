import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireTeacherAssignment } from "@/lib/apiAuth";
import { MIGRATION_HINT } from "@/lib/subjectGroups";
import { resolveSession } from "@/lib/serverContext";

/** GET ?subject_id=&session=&student_ids=a,b,c → { studentIds: [...] } marked "Not offering". */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const sp = req.nextUrl.searchParams;
  const subjectId = sp.get("subject_id") || "";
  const session = sp.get("session") || "";
  const studentIds = (sp.get("student_ids") || "").split(",").filter(Boolean);
  if (!subjectId || !session) {
    return NextResponse.json({ ok: false, error: "subject_id and session are required." }, { status: 400 });
  }

  let q = service.from("student_subject_optouts").select("student_id").eq("subject_id", subjectId).eq("session", session);
  if (authorization.actor.role === "teacher") {
    const classId = sp.get("class_id") || "";
    const sess = await resolveSession(service, session);
    if (!sess || !(await requireTeacherAssignment(authorization.actor, classId, subjectId, sess.id))) {
      return NextResponse.json({ error: "Subject assignment required." }, { status: 403 });
    }
    const { data: settings } = await service.from("app_settings").select("current_session").limit(1).maybeSingle();
    const roster = session === settings?.current_session
      ? await service.from("students").select("id").eq("class_id", classId)
      : await service.from("student_enrollments").select("id:student_id").eq("class_id", classId).eq("academic_session_id", sess.id);
    if (roster.error) return NextResponse.json({ error: "Could not verify the class roster." }, { status: 503 });
    if (!roster.data?.length) return NextResponse.json({ ok: true, studentIds: [] });
    q = q.in("student_id", roster.data.map(s => s.id));
  }
  if (studentIds.length) q = q.in("student_id", studentIds);
  const { data, error } = await q;
  if (error) {
    const missing = /student_subject_optouts/i.test(error.message || "");
    return NextResponse.json({ ok: false, error: missing ? MIGRATION_HINT : error.message }, { status: missing ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, studentIds: (data || []).map((r: any) => r.student_id) });
}

/** POST { student_id, subject_id, class_id, session, not_offering } */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { student_id, subject_id, class_id, session, not_offering } = body || {};
  if (!student_id || !subject_id || !class_id || !session) {
    return NextResponse.json({ ok: false, error: "student_id, subject_id, class_id and session are required." }, { status: 400 });
  }

  const sess = await resolveSession(service, session);
  if (!sess || !(await requireTeacherAssignment(actor, class_id, subject_id, sess.id))) {
    return NextResponse.json({ ok: false, error: "You are not assigned to this class and subject." }, { status: 403 });
  }

  if (typeof not_offering !== "boolean") return NextResponse.json({ error: "Invalid subject selection." }, { status: 400 });
  const { data: settings } = await service.from("app_settings").select("current_session, current_term").limit(1).maybeSingle();
  if (!settings?.current_session) return NextResponse.json({ error: "School session unavailable." }, { status: 503 });
  const roster = session === settings.current_session
    ? await service.from("students").select("id").eq("class_id", class_id).eq("id", student_id).maybeSingle()
    : await service.from("student_enrollments").select("id").eq("class_id", class_id).eq("academic_session_id", sess.id).eq("student_id", student_id).maybeSingle();
  if (!roster.data) {
    return NextResponse.json({ ok: false, error: "This student is not in the selected class." }, { status: 403 });
  }

  const { error } = await service.rpc("set_subject_optout", {
    p_student: student_id, p_subject: subject_id, p_class: class_id,
    p_session: session, p_drop: not_offering, p_actor: actor.dbUserId || null,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  return NextResponse.json({ ok: true });
}
