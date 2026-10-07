import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { rankPositions } from "@/lib/gradingEngine";
import { buildClassReports, levelGroupName, Milestone } from "@/lib/reportBuilder";

interface LeaderboardRow {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string;
  position: number;
  percentage: number;
  gpa: number | null;
  total: number;
  grade: string;
}

async function rankLevel(service: any, classIds: string[], term: string, session: string, milestone: Milestone) {
  const builds = await Promise.all(classIds.map((cid) => buildClassReports(service, { classId: cid, term, session, milestone })));
  const allReports = builds.flatMap((b) => b.reports);
  const isSenior = allReports[0]?.isSenior ?? false;

  const positions = rankPositions(allReports.map((r) => ({ id: r.student.id, value: isSenior ? r.summary.gpa : r.summary.percentage })));
  const rankedCount = positions.size;

  const rows: LeaderboardRow[] = allReports
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
    .filter((r): r is LeaderboardRow => r.position !== null)
    .sort((a, b) => a.position - b.position);

  return { isSenior, rankedCount, rows };
}

/**
 * GET — no `level`/`top` param: lists the available year-level groups (JSS
 * 1-3 are their own group each; SSS 1/2/3 each group their Science/Arts/
 * Commercial arms together, same grouping as applyLevelWidePositions).
 * GET ?level=&term=&session=&milestone=TR — the ranked leaderboard for that
 * one level, built from every class in the group combined.
 * GET ?top=1&term=&session=&milestone=TR — every level's #1 student, for a
 * side-by-side "best per class" view (each level ranked on its own; JSS1's
 * best is never compared against JSS3's).
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const sp = req.nextUrl.searchParams;
  const level = sp.get("level") || "";
  const top = sp.get("top") === "1";

  const { data: allClasses } = await service.from("classes").select("id, name, display_order").order("display_order");
  const classes = (allClasses || []) as { id: string; name: string; display_order: number }[];

  const groups = new Map<string, { name: string; classIds: string[]; classNames: string[]; order: number }>();
  classes.forEach((c) => {
    const g = levelGroupName(c.name);
    const entry = groups.get(g) || { name: g, classIds: [], classNames: [], order: c.display_order };
    entry.classIds.push(c.id);
    entry.classNames.push(c.name);
    groups.set(g, entry);
  });
  const levels = Array.from(groups.values()).sort((a, b) => a.order - b.order);

  if (!level && !top) {
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

  if (top) {
    const bests = await Promise.all(
      levels.map(async (g) => {
        const { isSenior, rows } = await rankLevel(service, g.classIds, term, session, milestone);
        return { level: g.name, classNames: g.classNames, best: rows[0] || null, studentCount: rows.length, isSenior };
      })
    );
    return NextResponse.json({ ok: true, term, session, milestone, bests });
  }

  const group = levels.find((g) => g.name === level);
  if (!group) return NextResponse.json({ ok: false, error: "Unknown level." }, { status: 404 });

  const { isSenior, rankedCount, rows } = await rankLevel(service, group.classIds, term, session, milestone);
  return NextResponse.json({ ok: true, level, isSenior, term, session, milestone, rankedCount, rows });
}
