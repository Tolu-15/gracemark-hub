import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { findStudentForActor, verifyPaystackReference } from "@/lib/financeServer";
import { applyCardPayment, onlineCardSalesEnabled } from "@/lib/scratchCards";

/** POST { reference } — the browser reports a finished checkout; Paystack (not the browser) decides if it counts. */
export async function POST(req: NextRequest) {
  if (!onlineCardSalesEnabled()) return NextResponse.json({ ok: false, error: "Not available." }, { status: 503 });
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service, authId, dbUserId } = actor;

  let body: { reference?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const reference = String(body.reference || "").trim();
  if (!reference) return NextResponse.json({ ok: false, error: "Payment reference is required." }, { status: 400 });

  try {
    const student = await findStudentForActor(service, authId, dbUserId);
    if (!student) return NextResponse.json({ ok: false, error: "Student record not found." }, { status: 404 });

    const txn = await verifyPaystackReference(reference);
    if (!txn) return NextResponse.json({ ok: false, error: "Paystack could not confirm this payment yet." }, { status: 422 });

    const result = await applyCardPayment(service, txn, { studentId: student.id });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });

    await logAudit(actor, {
      action: result.status === "duplicate" ? "scratch_card.duplicate_payment" : "scratch_card.purchase",
      entityType: "scratch_card_purchase",
      entityId: reference,
      summary:
        result.status === "duplicate"
          ? `Scratch card payment ${reference} succeeded but the student already held a card for that term: refund or credit needed`
          : `Scratch card bought online (${reference})`,
      metadata: { student_id: student.id, reference },
    });
    return NextResponse.json({ ok: true, status: result.status });
  } catch (err: any) {
    console.error("Scratch card verification error:", err);
    return NextResponse.json({ ok: false, error: "Payment verification failed. If you were charged, your card will appear shortly or contact the school with your reference." }, { status: 500 });
  }
}
