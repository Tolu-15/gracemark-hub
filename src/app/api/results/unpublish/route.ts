import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { classId, milestone, term, session } = body || {};
  try {
    // 1. Primary Source of Truth: Demote status on results table
    const statusCol: Record<string, any> =
      milestone === "PR1"
        ? { pr1_status: null }
        : milestone === "PR2"
        ? { pr2_status: null }
        : milestone === "PR3"
        ? { pr3_status: null }
        : { tr_status: null, status: "approved" };

    const { data: students } = await service
      .from("students")
      .select("id")
      .eq("class_id", classId);

    if (students && students.length > 0) {
      const sIds = students.map((s) => s.id);
      let rq = service.from("results").update(statusCol).in("student_id", sIds);
      if (term) rq = rq.eq("term", term);
      if (session) rq = rq.eq("session", session);
      const { error: resErr } = await rq;
      if (resErr) {
        console.error("results unpublish status update error:", resErr);
        throw resErr;
      }
    }

    // 2. Secondary Cache: Delete from published_snapshots
    let q = service
      .from("published_snapshots")
      .delete()
      .eq("class_id", classId)
      .eq("report_type", milestone);

    if (term) q = q.eq("term", term);
    if (session) q = q.eq("session", session);
    await q;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("handleUnpublishResults exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to unpublish." },
      { status: 500 }
    );
  }
}
