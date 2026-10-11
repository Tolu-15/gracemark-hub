import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { applyLevelWidePositions, buildClassReports, Milestone } from "@/lib/reportBuilder";

/**
 * GET ?class_id=&session=&term=&milestone=PR1|PR2|PR3|TR[&include_unpublished=1]
 * Every published (frozen) report card for one class, ready to print together.
 * With include_unpublished, students who have no published card yet are filled
 * in from their current scores and flagged `draft: true`, so a class can be
 * reviewed and printed before it is released.
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
  const includeUnpublished = sp.get("include_unpublished") === "1";
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
  if (!ids.length && !includeUnpublished) return NextResponse.json({ ok: true, reports: [], className: "" });

  let published: any[] = [];
  if (ids.length) {
    const { data: snaps, error } = await service
      .from("result_snapshots")
      .select("snapshot_data, published_at")
      .eq("term", term)
      .eq("report_type", milestone)
      .in("enrollment_id", ids);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    published = (snaps || []).map((s: any) => ({ ...s.snapshot_data, publishedAt: s.published_at }));
  }

  let reports: any[] = published;
  let notes: string[] = [];
  let className = published[0]?.className || "";
  if (includeUnpublished) {
    try {
      const build = await buildClassReports(service, { classId, term, session, milestone: milestone as Milestone });
      await applyLevelWidePositions(service, build);
      const publishedIds = new Set(published.map((r) => r.student?.id));
      const drafts = build.reports.filter((r) => !publishedIds.has(r.student.id)).map((r) => ({ ...r, draft: true }));
      reports = [...published, ...drafts];
      notes = build.issues.filter((i) => i.level === "block" || i.code === "not_approved").map((i) => i.message).slice(0, 8);
      className = className || build.className;
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || "Could not build the report cards." }, { status: 500 });
    }
  }

  reports.sort((a: any, b: any) => String(a.student?.name || "").localeCompare(String(b.student?.name || "")));
  const draftCount = reports.filter((r) => r.draft).length;

  await logAudit(actor, {
    action: "reports.bulk_view",
    entityType: "class",
    entityId: classId,
    summary: `Opened ${reports.length} ${milestone} report card(s) for bulk printing (${term}, ${session})${draftCount ? `, ${draftCount} unpublished` : ""}`,
    metadata: { class_id: classId, term, session, milestone, count: reports.length, unpublished: draftCount },
  });

  return NextResponse.json({ ok: true, reports, className: className || reports[0]?.className || "", draftCount, notes });
}
