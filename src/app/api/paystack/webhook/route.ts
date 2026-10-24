import { PAYMENTS_ENABLED } from "@/lib/features";
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  REF_PREFIX,
  applyAdmissionPayment,
  applySchoolFeePayment,
  verifyPaystackReference,
} from "@/lib/financeServer";
import { applyCardPayment, onlineCardSalesEnabled } from "@/lib/scratchCards";

/**
 * Paystack webhook. Records payments even when the payer closes the tab before the
 * browser callback runs. Set the URL in Paystack: https://<your-domain>/api/paystack/webhook
 *
 * Scratch card sales and school-fee/admission payments have separate switches. Whatever is
 * switched off is acknowledged and ignored, so Paystack stops retrying and nothing is recorded.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const service = getServiceClient();
  const cardsOn = service ? await onlineCardSalesEnabled(service) : false;
  if (!PAYMENTS_ENABLED && !cardsOn) return NextResponse.json({ ok: true, ignored: true });
  if (!secret || !service) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const raw = await req.text();
  const expected = createHmac("sha512", secret).update(raw).digest("hex");
  const given = req.headers.get("x-paystack-signature") || "";
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad payload." }, { status: 400 });
  }
  if (event?.event !== "charge.success") return NextResponse.json({ ok: true });

  const reference = String(event?.data?.reference || "");
  try {
    // Re-verify with Paystack rather than trusting the payload alone.
    const txn = await verifyPaystackReference(reference);
    if (!txn) return NextResponse.json({ ok: true, ignored: true });

    if (reference.startsWith(`${REF_PREFIX.card}-`)) {
      if (cardsOn) await applyCardPayment(service, txn);
    } else if (PAYMENTS_ENABLED) {
      if (reference.startsWith(`${REF_PREFIX.fees}-`)) await applySchoolFeePayment(service, txn);
      else if (reference.startsWith(`${REF_PREFIX.admission}-`)) await applyAdmissionPayment(service, txn);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Paystack webhook error:", err);
    // 500 makes Paystack retry.
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}
