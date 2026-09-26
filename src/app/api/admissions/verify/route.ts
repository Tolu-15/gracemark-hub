import { PAYMENTS_ENABLED } from "@/lib/features";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { applyAdmissionPayment, rateLimited, verifyPaystackReference } from "@/lib/financeServer";

/** Confirms an admission payment with Paystack and marks the application paid. */
export async function POST(req: NextRequest) {
  if (!PAYMENTS_ENABLED) return NextResponse.json({ error: "Admissions are coming soon." }, { status: 503 });
  const service = getServiceClient();
  if (!service) return NextResponse.json({ error: "Service unavailable." }, { status: 503 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(`admverify:${ip}`, 20, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const reference = String(body?.reference || "").trim();
  if (!reference) return NextResponse.json({ error: "Payment reference is required." }, { status: 400 });

  try {
    const txn = await verifyPaystackReference(reference);
    if (!txn) return NextResponse.json({ error: "Paystack could not confirm this payment." }, { status: 422 });
    const result = await applyAdmissionPayment(service, txn);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, application_number: result.application_number });
  } catch (err: any) {
    console.error("admissions verify error:", err);
    return NextResponse.json({ error: "Payment verification failed." }, { status: 500 });
  }
}
