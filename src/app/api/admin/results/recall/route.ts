import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { Milestone, MILESTONES } from "@/lib/reportBuilder";

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
  const { error } = await service.rpc("commit_publication", {
    p_class: class_id, p_session: session, p_term: term, p_type: milestone,
    p_actor: authorization.actor.dbUserId, p_version: null, p_reports: [], p_results: [],
    p_at: new Date().toISOString(), p_recall: true,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });

  const { data: cls } = await service.from("classes").select("name").eq("id", class_id).maybeSingle();
  await logAudit(authorization.actor, {
    action: "results.recall",
    entityType: "class",
    entityId: class_id,
    summary: `Recalled ${milestone} for ${cls?.name || "class"} (${term}, ${session}) back to draft`,
    metadata: { class_id, term, session, milestone },
  });
  return NextResponse.json({ ok: true });
}
