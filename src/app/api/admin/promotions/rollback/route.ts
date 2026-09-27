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

  const { data: promo } = await service.from("promotions").select("*").eq("id", promotionId).maybeSingle();
  if (!promo) return NextResponse.json({ ok: false, error: "Promotion record not found." }, { status: 404 });
  if (promo.rolled_back_at) {
    return NextResponse.json({ ok: false, error: "This promotion has already been rolled back." }, { status: 409 });
  }

  const { data: later } = await service
    .from("promotions")
    .select("id")
    .gt("promoted_at", promo.promoted_at)
    .is("rolled_back_at", null)
    .limit(1);
  if (later?.length) {
    return NextResponse.json(
      { ok: false, error: "A newer promotion exists. Roll back the most recent promotion first." },
      { status: 409 }
    );
  }

  const [{ data: fromSess }, { data: toSess }, { data: classes }] = await Promise.all([
    service.from("academic_sessions").select("id, name").eq("id", promo.from_session_id).maybeSingle(),
    service.from("academic_sessions").select("id, name").eq("id", promo.to_session_id).maybeSingle(),
    service.from("classes").select("id, name"),
  ]);
  const classIdByName = new Map((classes || []).map((c: any) => [String(c.name).trim().toUpperCase(), c.id as string]));
  const sameSession = promo.from_session_id === promo.to_session_id;

  const restored: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const item of (promo.summary as any[]) || []) {
    const studentId: string = item.student_id;
    const name: string = item.name || "Student";
    const action: string = item.action;
    if (!studentId) continue;

    const fromClassId: string | undefined =
      item.from_class_id || classIdByName.get(String(item.from_class || "").trim().toUpperCase());
    const toClassId: string | undefined = item.to_class_id || classIdByName.get(String(item.to_class || "").trim().toUpperCase());

    try {
      // Results already captured in the new session would be lost with the enrollment.
      if (!sameSession && toSess?.name && action !== "graduated") {
        const { count } = await service
          .from("results")
          .select("id", { count: "exact", head: true })
          .eq("student_id", studentId)
          .eq("session", toSess.name);
        if (count && count > 0) {
          skipped.push({ name, reason: `already has results in ${toSess.name}` });
          continue;
        }
      }

      if (action === "promoted") {
        if (toClassId) {
          const { data: cur } = await service.from("students").select("*").eq("id", studentId).maybeSingle();
          const currentClass = (cur as any)?.current_class_id ?? (cur as any)?.class_id;
          if (currentClass && currentClass !== toClassId) {
            skipped.push({ name, reason: "class was changed after the promotion" });
            continue;
          }
        }
        if (!sameSession) {
          await service.from("student_enrollments").delete().eq("student_id", studentId).eq("academic_session_id", promo.to_session_id);
        }
        await service
          .from("student_enrollments")
          .update({ status: "active" })
          .eq("student_id", studentId)
          .eq("academic_session_id", promo.from_session_id);
        if (fromClassId) {
          const { error: cErr } = await service.from("students").update({ current_class_id: fromClassId }).eq("id", studentId);
          if (cErr) await service.from("students").update({ class_id: fromClassId }).eq("id", studentId);
        }
      } else if (action === "graduated") {
        await service.from("students").update({ is_alumni: false }).eq("id", studentId);
        await service
          .from("student_enrollments")
          .update({ status: "active" })
          .eq("student_id", studentId)
          .eq("academic_session_id", promo.from_session_id);
      } else if (action === "repeat") {
        if (!sameSession) {
          await service.from("student_enrollments").delete().eq("student_id", studentId).eq("academic_session_id", promo.to_session_id);
        }
      }
      restored.push(name);
    } catch (err: any) {
      skipped.push({ name, reason: err?.message || "unexpected error" });
    }
  }

  await service
    .from("promotions")
    .update({ rolled_back_at: new Date().toISOString(), rolled_back_by: actor.dbUserId ?? null })
    .eq("id", promotionId);

  await logAudit(actor, {
    action: "promotion.rollback",
    entityType: "promotion",
    entityId: promotionId,
    summary: `Rolled back promotion of ${fromSess?.name || "?"} → ${toSess?.name || "?"}: ${restored.length} restored, ${skipped.length} skipped`,
    metadata: { restored: restored.length, skipped },
  });

  return NextResponse.json({
    ok: true,
    restored: restored.length,
    skipped,
    message: `Restored ${restored.length} student(s).${skipped.length ? ` ${skipped.length} skipped.` : ""}`,
  });
}
