import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { findStudentForActor } from "@/lib/financeServer";
import { FAILED_PIN_WINDOW_MINUTES, MAX_FAILED_PINS, hashPin, normalizePin } from "@/lib/scratchCards";

/**
 * POST { pin }
 * Activates a card the school issued (offline or complimentary) once the parent enters its PIN.
 * The card is already bound to this student, so a PIN issued for another child never works here.
 * Wrong PINs are rate limited per student.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service, authId, dbUserId } = actor;

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const pin = normalizePin(body.pin || "");
  if (pin.length < 8) return NextResponse.json({ ok: false, error: "Please enter the full PIN from your card." }, { status: 400 });

  const student = await findStudentForActor(service, authId, dbUserId);
  if (!student) return NextResponse.json({ ok: false, error: "Student record not found." }, { status: 404 });

  const since = new Date(Date.now() - FAILED_PIN_WINDOW_MINUTES * 60_000).toISOString();
  const { count } = await service
    .from("scratch_card_failures")
    .select("id", { count: "exact", head: true })
    .eq("student_id", student.id)
    .gte("created_at", since);
  if ((count || 0) >= MAX_FAILED_PINS) {
    return NextResponse.json(
      { ok: false, error: `Too many wrong PINs. Please wait ${FAILED_PIN_WINDOW_MINUTES} minutes and try again.` },
      { status: 429 }
    );
  }

  const { data: card } = await service
    .from("scratch_cards")
    .select("id, serial, status, student_id, term_code, academic_session_id")
    .eq("pin_hash", hashPin(pin))
    .maybeSingle();

  if (!card || card.student_id !== student.id) {
    await service.from("scratch_card_failures").insert({ student_id: student.id, auth_id: authId });
    return NextResponse.json({ ok: false, error: "That PIN is not valid for this student." }, { status: 400 });
  }
  if (card.status === "active") return NextResponse.json({ ok: true, alreadyActive: true, term: card.term_code });
  if (card.status !== "issued") {
    return NextResponse.json({ ok: false, error: "This card has already been used up or cancelled." }, { status: 400 });
  }

  const { data: activated } = await service
    .from("scratch_cards")
    .update({ status: "active", activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", card.id)
    .eq("status", "issued")
    .select("id");
  if (!activated?.length) return NextResponse.json({ ok: true, alreadyActive: true, term: card.term_code });

  await logAudit(actor, {
    action: "scratch_card.activate",
    entityType: "scratch_card",
    entityId: card.id,
    summary: `Activated scratch card ${card.serial} (${card.term_code})`,
    metadata: { student_id: student.id, term: card.term_code },
  });
  return NextResponse.json({ ok: true, term: card.term_code });
}
