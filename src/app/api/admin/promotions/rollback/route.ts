import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

/**
 * POST { promotionId } — undoes a promotion run.
 *
 * Only the most recent, not-yet-rolled-back promotion can be undone. Each student is
 * restored individually; a student is skipped (and reported) when undoing would lose
 * data: they already have results in the new session, or their class was changed
 * manually after the promotion.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const body = await req.json().catch(() => null);
  const promotionId = String(body?.promotionId || "");
  if (!promotionId) return NextResponse.json({ ok: false, error: "promotionId is required." }, { status: 400 });

  const { data, error } = await service.rpc("rollback_promotions", {
    p_id: promotionId, p_actor: actor.dbUserId,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "P0002" ? 404 : 409 });
  const { restored, skipped } = data;
  await logAudit(actor, {
    action: "promotion.rollback", entityType: "promotion", entityId: promotionId,
    summary: `Restored ${restored} student(s), skipped ${skipped.length}.`,
    metadata: { restored, skipped },
  });
  return NextResponse.json({ ok: true, restored, skipped,
    message: `Restored ${restored} student(s).${skipped.length ? " " + skipped.length + " skipped." : ""}`,
  });
}
