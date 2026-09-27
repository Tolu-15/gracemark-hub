import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

/**
 * GET ?class_id=&session=&term=&milestone=PR1|PR2|PR3|TR
 * Every published (frozen) report card for one class, ready to print together.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const sp = req.nextUrl.searchParams;
  const classId = sp.get("class_id") || "";
  const session = sp.get("session") || "";
  const term = sp.get("term") || "";
  const milestone = sp.get("milestone") || "";
  if (!classId || !session || !term || !["PR1", "PR2", "PR3", "TR"].includes(milestone)) {
    return NextResponse.json({ ok: false, error: "class_id, session, term and milestone are required." }, { status: 400 });
  }

  const { data: sess } = await service.from("academic_sessions").select("id").eq("name", session).maybeSingle();
  if (!sess?.id) return NextResponse.json({ ok: false, error: `Session "${session}" was not found.` }, { status: 404 });

  const { data: enrollments, error: enErr } = await service
    .from("student_enrollments")
    .select("id")
    .eq("class_id", classId)
    .eq("academic_session_id", sess.id);
  if (enErr) return NextResponse.json({ ok: false, error: enErr.message }, { status: 500 });
  const ids = (enrollments || []).map((e: any) => e.id);
  if (!ids.length) return NextResponse.json({ ok: true, reports: [], className: "" });

  const { data: snaps, error } = await service
    .from("result_snapshots")
    .select("snapshot_data, published_at")
    .eq("term", term)
    .eq("report_type", milestone)
    .in("enrollment_id", ids);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const reports = (snaps || [])
    .map((s: any) => ({ ...s.snapshot_data, publishedAt: s.published_at }))
    .sort((a: any, b: any) => String(a.student?.name || "").localeCompare(String(b.student?.name || "")));

  await logAudit(actor, {
    action: "reports.bulk_view",
    entityType: "class",
    entityId: classId,
    summary: `Opened ${reports.length} ${milestone} report card(s) for bulk printing (${term}, ${session})`,
    metadata: { class_id: classId, term, session, milestone, count: reports.length },
  });

  return NextResponse.json({ ok: true, reports, className: reports[0]?.className || "" });
}
