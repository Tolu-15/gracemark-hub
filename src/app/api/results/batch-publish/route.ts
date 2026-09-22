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

  const { snapshots = [], resultIds = [], statusCol = {} } = body || {};

  try {
    // 1. Upsert into published_snapshots
    if (snapshots.length > 0) {
      const { error: snapErr } = await service
        .from("published_snapshots")
        .upsert(snapshots, { onConflict: "term,session,student_id,report_type" });
      if (snapErr) {
        console.warn("published_snapshots upsert error:", snapErr);
      }
    }

    // 2. Update status in results table
    if (resultIds.length > 0 && Object.keys(statusCol).length > 0) {
      const { error: resErr } = await service
        .from("results")
        .update(statusCol)
        .in("id", resultIds);
      if (resErr) {
        console.warn("results update error:", resErr);
      }
    }

    return NextResponse.json({ ok: true, publishedCount: snapshots.length });
  } catch (err: any) {
    console.error("handleBatchPublishResults exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to publish." },
      { status: 500 }
    );
  }
}
