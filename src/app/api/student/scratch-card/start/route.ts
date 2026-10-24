import { PAYMENTS_ENABLED } from "@/lib/features";
import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { findStudentForActor, getPaystackPublicKey } from "@/lib/financeServer";
import { isTermCode } from "@/lib/serverContext";
import {
  CARD_PRICE_NAIRA,
  createPurchase,
  findEnrollment,
  getCardState,
  getPublishedTr,
  onlinePaymentsConfigured,
} from "@/lib/scratchCards";

/**
 * POST { session, term }
 * Starts an online purchase: records a pending order and returns the Paystack reference and public
 * key for the checkout popup. The card itself is only created after Paystack confirms the payment
 * (browser callback, webhook or recovery), never from this request.
 */
export async function POST(req: NextRequest) {
  if (!PAYMENTS_ENABLED || !onlinePaymentsConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Online payment is not available yet. Please buy a card from the school office." },
      { status: 503 }
    );
  }
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { service, authId, dbUserId, email } = authorization.actor;

  let body: { session?: string; term?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const session = String(body.session || "").trim();
  const term = String(body.term || "").trim();
  if (!session || !isTermCode(term)) return NextResponse.json({ ok: false, error: "Session and term are required." }, { status: 400 });

  try {
    const student = await findStudentForActor(service, authId, dbUserId);
    if (!student) return NextResponse.json({ ok: false, error: "Student record not found." }, { status: 404 });

    const enrollment = await findEnrollment(service, student.id, session);
    if (!enrollment || !(await getPublishedTr(service, enrollment.enrollmentId, term))) {
      return NextResponse.json({ ok: false, error: "The terminal result has not been published yet." }, { status: 409 });
    }

    const existing = await getCardState(service, student.id, enrollment.sessionId, term);
    if (existing && (existing.status === "active" || existing.status === "issued")) {
      return NextResponse.json({ ok: false, error: "You already have a scratch card for this term." }, { status: 409 });
    }

    const reference = await createPurchase(service, { studentId: student.id, sessionId: enrollment.sessionId, termCode: term });
    return NextResponse.json({
      ok: true,
      reference,
      amountKobo: CARD_PRICE_NAIRA * 100,
      publicKey: await getPaystackPublicKey(service),
      email: email || "",
    });
  } catch (err: any) {
    console.error("Scratch card start error:", err);
    return NextResponse.json({ ok: false, error: "Could not start the payment. Please try again." }, { status: 500 });
  }
}
