import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service, dbUserId } = authorization.actor;
  const actor = authorization.actor;

  try {
    const body = await req.json();
    const {
      promotions = [], // Array of { studentId, studentName, fromClassId, toClassId, nextClassName, action: 'promote' | 'graduate' | 'repeat' }
      currentSession,
      currentSessionId,
      nextSession,
      nextSessionId,
      notes = "",
    } = body;

    if (!promotions.length) {
      return NextResponse.json({ ok: false, error: "No student promotion records provided." }, { status: 400 });
    }

    if (!Array.isArray(promotions) || !(currentSessionId || currentSession) || !(nextSessionId || nextSession)) {
      return NextResponse.json({ ok: false, error: "Select source and destination sessions." }, { status: 400 });
    }
    const { data, error } = await service.rpc("commit_promotions", {
      p_source: currentSessionId || null, p_source_name: currentSession || null,
      p_dest: nextSessionId || null, p_dest_name: nextSession || null,
      p_items: promotions, p_actor: dbUserId, p_notes: notes?.trim() || null,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    const { summary, skipped, promotionId } = data;
    const overridden = promotions.filter((item: { override?: boolean }) => item.override === true).length;
    await logAudit(actor, {
      action: "promotion.execute",
      entityType: "promotion",
      entityId: promotionId,
      summary: `Promoted ${summary.length} students (${currentSession || "?"} → ${nextSession || "?"})`,
      metadata: {
        promoted: summary.filter((s: { action: string }) => s.action === "promoted").length,
        graduated: summary.filter((s: { action: string }) => s.action === "graduated").length,
        repeated: summary.filter((s: { action: string }) => s.action === "repeat").length,
        skipped_unpublished: skipped.length,
        admin_overrides: overridden,
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Processed ${summary.length} students.${skipped.length ? ` ${skipped.length} skipped (3rd-term result not published).` : ""}`,
      skipped,
      summary,
      promotionId: promotionId,
    });
  } catch (err: any) {
    console.error("Promotions API execution error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Failed to execute promotions." }, { status: 500 });
  }
}
