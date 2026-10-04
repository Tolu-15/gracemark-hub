import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

/** GET ?term=&session=&level= — every awarded badge, newest first, with the student's name. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const sp = req.nextUrl.searchParams;
  const term = sp.get("term") || "";
  const session = sp.get("session") || "";
  const level = sp.get("level") || "";

  let query = service
    .from("student_badges")
    .select("id, student_id, badge_type, level_name, class_name, position, ranked_count, term, session, awarded_at, students(name, admission_no)")
    .order("awarded_at", { ascending: false });
  if (term) query = query.eq("term", term);
  if (session) query = query.eq("session", session);
  if (level) query = query.eq("level_name", level);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, badges: data || [] });
}
