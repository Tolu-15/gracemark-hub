import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { isTermCode, resolveSession, getCurrentContext } from "@/lib/serverContext";
import { assignmentOptions } from "@/lib/timetableServer";

/**
 * GET ?session=&term=&class_id=  (admin)
 * The subject/teacher pairs assigned to the class that session, with how many periods each
 * already has this term versus the subject's periods-per-week target.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;
  const sp = req.nextUrl.searchParams;

  const classId = sp.get("class_id") || "";
  if (!classId) return NextResponse.json({ ok: false, error: "class_id is required." }, { status: 400 });
  const session = await resolveSession(service, sp.get("session"));
  if (!session) return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });
  const ctx = await getCurrentContext(service);
  const term = isTermCode(sp.get("term")) ? sp.get("term")! : ctx?.term || "term1";

  const options = await assignmentOptions(service, session.id, classId);
  const { data: slots } = await service
    .from("timetable_slots")
    .select("subject_id")
    .eq("academic_session_id", session.id)
    .eq("term_code", term)
    .eq("class_id", classId);
  const counts = new Map<string, number>();
  (slots || []).forEach((s: any) => counts.set(s.subject_id, (counts.get(s.subject_id) || 0) + 1));

  return NextResponse.json({
    ok: true,
    options: options.map((o) => ({ ...o, scheduled: counts.get(o.subject_id) || 0 })),
  });
}
