import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

/** POST { studentId } — deletes every result and published report-card snapshot for a student. For wiping demo/test records clean, not for real students. */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!(await requireDeveloper(actor))) return NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 });
  const { service } = actor;

  const body = await req.json().catch(() => null);
  const studentId = String(body?.studentId || "");
  if (!studentId) return NextResponse.json({ ok: false, error: "studentId is required." }, { status: 400 });

  const { data: student } = await service.from("students").select("id, name, full_name").eq("id", studentId).maybeSingle();
  if (!student) return NextResponse.json({ ok: false, error: "Student not found." }, { status: 404 });

  const { data: enrollments } = await service.from("student_enrollments").select("id").eq("student_id", studentId);
  const enrollmentIds = (enrollments || []).map((e: any) => e.id);

  let snapshotsDeleted = 0;
  if (enrollmentIds.length > 0) {
    const { data: deletedSnapshots, error: snapErr } = await service.from("result_snapshots").delete().in("enrollment_id", enrollmentIds).select("id");
    if (snapErr) return NextResponse.json({ ok: false, error: snapErr.message }, { status: 500 });
    snapshotsDeleted = (deletedSnapshots || []).length;
  }

  const { data: deletedResults, error: resErr } = await service.from("results").delete().eq("student_id", studentId).select("id");
  if (resErr) return NextResponse.json({ ok: false, error: resErr.message }, { status: 500 });
  const resultsDeleted = (deletedResults || []).length;

  const name = (student as any).full_name || (student as any).name || "Student";
  await logAudit(actor, {
    action: "dev_tools.clear_student_results",
    entityType: "student",
    entityId: studentId,
    summary: `Cleared ${resultsDeleted} result(s) and ${snapshotsDeleted} snapshot(s) for ${name}`,
    metadata: { resultsDeleted, snapshotsDeleted },
  });

  return NextResponse.json({ ok: true, resultsDeleted, snapshotsDeleted });
}
