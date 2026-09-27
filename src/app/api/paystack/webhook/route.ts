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

/**
 * Paystack webhook. Records payments even when the payer closes the tab before the
 * browser callback runs. Set the URL in Paystack: https://<your-domain>/api/paystack/webhook
 */
export async function POST(req: NextRequest) {
  // Payments are switched off: acknowledge so Paystack stops retrying, record nothing.
  if (!PAYMENTS_ENABLED) return NextResponse.json({ ok: true, ignored: true });
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const service = getServiceClient();
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

    if (reference.startsWith(`${REF_PREFIX.fees}-`)) await applySchoolFeePayment(service, txn);
    else if (reference.startsWith(`${REF_PREFIX.admission}-`)) await applyAdmissionPayment(service, txn);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Paystack webhook error:", err);
    // 500 makes Paystack retry.
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}
