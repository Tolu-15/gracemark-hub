import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { rankPositions } from "@/lib/gradingEngine";
import { buildClassReports, levelGroupName, Milestone } from "@/lib/reportBuilder";

/**
 * GET — no `level` param: lists the available year-level groups (JSS 1-3 are
 * their own group each; SSS 1/2/3 each group their Science/Arts/Commercial
 * arms together, same grouping as applyLevelWidePositions).
 * GET ?level=&term=&session=&milestone=TR — the ranked leaderboard for that
 * level, built from every class in the group combined.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const sp = req.nextUrl.searchParams;
  const level = sp.get("level") || "";

  const { data: allClasses } = await service.from("classes").select("id, name, display_order").order("display_order");
  const classes = (allClasses || []) as { id: string; name: string; display_order: number }[];

  if (!level) {
    const groups = new Map<string, { name: string; classIds: string[]; classNames: string[]; order: number }>();
    classes.forEach((c) => {
      const g = levelGroupName(c.name);
      const entry = groups.get(g) || { name: g, classIds: [], classNames: [], order: c.display_order };
      entry.classIds.push(c.id);
      entry.classNames.push(c.name);
      groups.set(g, entry);
    });
    const levels = Array.from(groups.values()).sort((a, b) => a.order - b.order);
    return NextResponse.json({ ok: true, levels });
  }

  const term = sp.get("term") || "term1";
  const milestone = (sp.get("milestone") || "TR") as Milestone;
  let session = sp.get("session") || "";
  if (!session) {
    const { data: settings } = await service.from("app_settings").select("current_session").limit(1).maybeSingle();
    session = settings?.current_session || "";
  }
  if (!session) return NextResponse.json({ ok: false, error: "No academic session is set." }, { status: 400 });

  const classIds = classes.filter((c) => levelGroupName(c.name) === level).map((c) => c.id);
  if (!classIds.length) return NextResponse.json({ ok: false, error: "Unknown level." }, { status: 404 });

  const builds = await Promise.all(classIds.map((cid) => buildClassReports(service, { classId: cid, term, session, milestone })));
  const allReports = builds.flatMap((b) => b.reports);
  const isSenior = allReports[0]?.isSenior ?? false;

  const positions = rankPositions(allReports.map((r) => ({ id: r.student.id, value: isSenior ? r.summary.gpa : r.summary.percentage })));
  const rankedCount = positions.size;

  const rows = allReports
    .map((r) => ({
      studentId: r.student.id,
      name: r.student.name,
      admissionNo: r.student.admissionNo,
      className: r.className,
      position: positions.get(r.student.id) ?? null,
      percentage: r.summary.percentage,
      gpa: r.summary.gpa,
      total: r.summary.total,
      grade: r.summary.grade,
    }))
    .filter((r) => r.position !== null)
    .sort((a, b) => (a.position as number) - (b.position as number));

  return NextResponse.json({ ok: true, level, isSenior, term, session, milestone, rankedCount, rows });
}
