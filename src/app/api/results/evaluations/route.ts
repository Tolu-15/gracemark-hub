import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, ApiActor } from "@/lib/apiAuth";
import { PERSONAL_SKILLS } from "@/lib/gradingEngine";
import { ensureEnrollments } from "@/lib/reportBuilder";

async function canManageClass(actor: ApiActor, classId: string): Promise<boolean> {
  if (actor.role === "admin") return true;
  const ids = Array.from(new Set([actor.authId, actor.dbUserId].filter(Boolean))) as string[];
  const [cta, sta] = await Promise.all([
    actor.service.from("class_teacher_assignments").select("id").eq("class_id", classId).eq("status", "active").in("teacher_user_id", ids).limit(1),
    actor.service.from("subject_teacher_assignments").select("id").eq("class_id", classId).eq("status", "active").in("teacher_user_id", ids).limit(1),
  ]);
  return Boolean(cta.data?.length || sta.data?.length);
}

async function sessionInfo(service: any) {
  const { data: settings } = await service.from("app_settings").select("current_session").limit(1).maybeSingle();
  const session = settings?.current_session || "";
  const { data: sess } = session ? await service.from("academic_sessions").select("id").eq("name", session).maybeSingle() : { data: null };
  return { session, sessionId: sess?.id as string | undefined };
}

/** GET ?class_id=&term= → students with their personal skills and remarks (current session). */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const classId = req.nextUrl.searchParams.get("class_id") || "";
  const term = req.nextUrl.searchParams.get("term") || "";
  if (!classId || !term) return NextResponse.json({ ok: false, error: "class_id and term are required." }, { status: 400 });
  if (!(await canManageClass(actor, classId))) {
    return NextResponse.json({ ok: false, error: "You are not assigned to this class." }, { status: 403 });
  }

  const { session, sessionId } = await sessionInfo(service);
  const { data: students, error } = await service
    .from("students")
    .select("id, name, admission_no")
    .eq("class_id", classId)
    .order("name");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const ids = (students || []).map((s: any) => s.id);
  const byStudent = new Map<string, any>();
  if (sessionId && ids.length) {
    const { data: enrollments } = await service
      .from("student_enrollments")
      .select("id, student_id")
      .eq("academic_session_id", sessionId)
      .in("student_id", ids);
    const studentOf = new Map((enrollments || []).map((e: any) => [e.id, e.student_id]));
    if (studentOf.size) {
      const { data: evals } = await service
        .from("student_evaluations")
        .select("enrollment_id, skills, teacher_remark, principal_remark")
        .eq("term", term)
        .in("enrollment_id", Array.from(studentOf.keys()));
      (evals || []).forEach((e: any) => byStudent.set(studentOf.get(e.enrollment_id) as string, e));
    }
  }

  return NextResponse.json({
    ok: true,
    session,
    students: (students || []).map((s: any) => {
      const e = byStudent.get(s.id);
      return {
        id: s.id,
        name: s.name,
        admission_no: s.admission_no,
        skills: e?.skills || {},
        teacher_remark: e?.teacher_remark || "",
        principal_remark: e?.principal_remark || "",
      };
    }),
  });
}

/** POST { class_id, term, rows: [{ student_id, skills, teacher_remark, principal_remark? }] } */
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
  const { class_id, term } = body || {};
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
  if (!class_id || !["term1", "term2", "term3"].includes(term)) {
    return NextResponse.json({ ok: false, error: "class_id and a valid term are required." }, { status: 400 });
  }
  if (!(await canManageClass(actor, class_id))) {
    return NextResponse.json({ ok: false, error: "You are not assigned to this class." }, { status: 403 });
  }
  if (!actor.dbUserId) return NextResponse.json({ ok: false, error: "Your account has no user profile." }, { status: 400 });

  const { sessionId } = await sessionInfo(service);
  if (!sessionId) return NextResponse.json({ ok: false, error: "No current session is set." }, { status: 400 });

  const { data: classStudents } = await service.from("students").select("id").eq("class_id", class_id);
  const inClass = new Set((classStudents || []).map((s: any) => s.id));
  const valid = rows.filter((r) => inClass.has(r.student_id));
  if (!valid.length) return NextResponse.json({ ok: true, saved: 0 });

  await ensureEnrollments(service, class_id, sessionId, valid.map((r) => r.student_id));
  const { data: enrollments } = await service
    .from("student_enrollments")
    .select("id, student_id")
    .eq("academic_session_id", sessionId)
    .in("student_id", valid.map((r) => r.student_id));
  const enrollmentOf = new Map((enrollments || []).map((e: any) => [e.student_id, e.id]));

  const payload = valid.map((r) => {
    const skills: Record<string, number> = {};
    PERSONAL_SKILLS.forEach((k) => {
      const v = Number(r.skills?.[k.key]);
      if (Number.isFinite(v) && v >= 1 && v <= 5) skills[k.key] = Math.round(v);
    });
    return {
      enrollment_id: enrollmentOf.get(r.student_id),
      term,
      skills,
      teacher_remark: String(r.teacher_remark || "").trim() || null,
      ...(actor.role === "admin" ? { principal_remark: String(r.principal_remark || "").trim() || null } : {}),
      evaluated_by: actor.dbUserId,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await service.from("student_evaluations").upsert(payload, { onConflict: "enrollment_id,term" });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, saved: payload.length });
}
