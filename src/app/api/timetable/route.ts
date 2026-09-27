import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { getCurrentContext, isTermCode, resolveSession, studentClassId, teacherClassIds } from "@/lib/serverContext";
import { decorateSlots } from "@/lib/timetableServer";

/**
 * GET ?session=&term=  plus one of:
 *   class_id=   a class timetable (admin any; teacher only their classes; students: their own class, implied)
 *   mine=1      the signed-in teacher's own week across classes
 *   teacher_id= (admin) one teacher's week
 *   all=1       (admin, teacher) every slot of the term — the whole-school general timetable,
 *               and how admins see which teachers are busy
 * Session and term default to the school's current ones.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"], { allowLockedStudent: true });
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  const sp = req.nextUrl.searchParams;

  const ctx = await getCurrentContext(service);
  const session = await resolveSession(service, sp.get("session"));
  if (!session) return NextResponse.json({ ok: false, error: "No academic session is set up." }, { status: 400 });
  const termParam = sp.get("term");
  const term = isTermCode(termParam) ? termParam : ctx?.term || "term1";

  const { data: periods } = await service.from("timetable_periods").select("*").order("position");

  let query = service
    .from("timetable_slots")
    .select("*")
    .eq("academic_session_id", session.id)
    .eq("term_code", term);

  let scope: "class" | "teacher" | "all" = "class";
  if (actor.role === "student") {
    const classId = await studentClassId(service, actor, session.id);
    if (!classId) return NextResponse.json({ ok: true, session: session.name, term, periods: periods || [], slots: [], scope: "class" });
    query = query.eq("class_id", classId);
  } else if (actor.role === "teacher") {
    if (sp.get("all") === "1") {
      scope = "all";
    } else if (sp.get("mine") === "1") {
      scope = "teacher";
      query = query.eq("teacher_user_id", actor.dbUserId || "");
    } else {
      const classId = sp.get("class_id") || "";
      const mine = await teacherClassIds(service, actor, session.id);
      if (!classId || !mine.has(classId)) {
        return NextResponse.json({ ok: false, error: "You can only view timetables of classes you teach." }, { status: 403 });
      }
      query = query.eq("class_id", classId);
    }
  } else {
    if (sp.get("all") === "1") {
      scope = "all";
    } else if (sp.get("teacher_id")) {
      scope = "teacher";
      query = query.eq("teacher_user_id", sp.get("teacher_id")!);
    } else if (sp.get("class_id")) {
      query = query.eq("class_id", sp.get("class_id")!);
    } else {
      return NextResponse.json({ ok: false, error: "class_id, teacher_id or all=1 is required." }, { status: 400 });
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const slots = await decorateSlots(service, data || []);
  return NextResponse.json({ ok: true, session: session.name, term, periods: periods || [], slots, scope });
}
