import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { buildClassReports, Milestone, MILESTONES } from "@/lib/reportBuilder";

/** GET ?class_id=&term=&milestone=&student_id= → the report exactly as it would be published now. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const sp = req.nextUrl.searchParams;
  const classId = sp.get("class_id") || "";
  const term = sp.get("term") || "";
  const milestone = sp.get("milestone") as Milestone;
  const studentId = sp.get("student_id") || "";
  if (!classId || !term || !MILESTONES.includes(milestone)) {
    return NextResponse.json({ ok: false, error: "class_id, term and milestone are required." }, { status: 400 });
  }

  const { data: settings } = await service.from("app_settings").select("current_session").limit(1).maybeSingle();
  try {
    const build = await buildClassReports(service, { classId, term, session: settings?.current_session || "", milestone });
    const report = build.reports.find((r) => r.student.id === studentId) || build.reports[0] || null;
    return NextResponse.json({ ok: true, report });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
