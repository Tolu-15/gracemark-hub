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
    // 1. Primary Source of Truth: Set status = 'published' in results table
    const updatePayload: Record<string, any> = { ...statusCol, status: "published" };
    if (resultIds.length > 0) {
      const { error: resErr } = await service
        .from("results")
        .update(updatePayload)
        .in("id", resultIds);
      if (resErr) {
        console.error("results publication update error:", resErr);
        throw resErr;
      }
    }

    // 2. Secondary Cache: Upsert into published_snapshots for historical snapshots
    if (snapshots.length > 0) {
      const { error: snapErr } = await service
        .from("published_snapshots")
        .upsert(snapshots, { onConflict: "term,session,student_id,report_type" });
      if (snapErr) {
        console.warn("published_snapshots secondary cache upsert warning:", snapErr);
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
