import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { resolveStudentRecord } from "@/lib/cbtAuth";

/** GET — every position badge the signed-in student has earned, newest first. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const student = await resolveStudentRecord(actor);
  if (!student) return NextResponse.json({ ok: false, error: "Student profile not found." }, { status: 404 });

  const { data, error } = await service
    .from("student_badges")
    .select("id, badge_type, level_name, class_name, position, ranked_count, term, session, awarded_at")
    .eq("student_id", student.id)
    .order("session", { ascending: false })
    .order("awarded_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, badges: data || [] });
}
