import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { Milestone, MILESTONES, STATUS_COLUMN } from "@/lib/reportBuilder";

/**
 * POST { class_id, term, milestone }
 * Hides one published milestone for one class (current session). Approval
 * status is not touched, so the milestone can be published again as-is.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const { class_id, term } = body || {};
  const milestone = body?.milestone as Milestone;
  if (!class_id || !term || !MILESTONES.includes(milestone)) {
    return NextResponse.json({ ok: false, error: "class_id, term and milestone are required." }, { status: 400 });
  }

  const { data: settings } = await service.from("app_settings").select("current_session").limit(1).maybeSingle();
  const session = settings?.current_session || "";
  const { data: sess } = await service.from("academic_sessions").select("id").eq("name", session).maybeSingle();

  const { data: students } = await service.from("students").select("id").eq("class_id", class_id);
  const studentIds = (students || []).map((s: any) => s.id);
  if (!studentIds.length || !sess?.id) return NextResponse.json({ ok: true, recalled: 0 });

  const { data: enrollments } = await service
    .from("student_enrollments")
    .select("id")
    .eq("academic_session_id", sess.id)
    .in("student_id", studentIds);
  const enrollIds = (enrollments || []).map((e: any) => e.id);

  if (enrollIds.length) {
    const { error } = await service
      .from("result_snapshots")
      .delete()
      .eq("term", term)
      .eq("report_type", milestone)
      .in("enrollment_id", enrollIds);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const { error: stErr } = await service
    .from("results")
    .update({ [STATUS_COLUMN[milestone]]: "draft" })
    .eq("term", term)
    .eq("session", session)
    .in("student_id", studentIds);
  if (stErr) return NextResponse.json({ ok: false, error: stErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
