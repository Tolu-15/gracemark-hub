import { PAYMENTS_ENABLED } from "@/lib/features";
import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { applySchoolFeePayment, findStudentForActor, verifyPaystackReference } from "@/lib/financeServer";

/** Student confirms a school-fee payment; Paystack (not the browser) decides whether it counts. */
export async function POST(req: NextRequest) {
  if (!PAYMENTS_ENABLED) return NextResponse.json({ error: "Not available." }, { status: 503 });
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { service, authId, dbUserId } = authorization.actor;

  let body: { reference?: string; invoice_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const reference = body.reference?.trim();
  const invoiceId = body.invoice_id?.trim();
  if (!reference || !invoiceId) {
    return NextResponse.json({ error: "Payment reference and invoice are required." }, { status: 400 });
  }

  try {
    const student = await findStudentForActor(service, authId, dbUserId);
    if (!student) return NextResponse.json({ error: "Student profile not found." }, { status: 403 });

    const txn = await verifyPaystackReference(reference);
    if (!txn) return NextResponse.json({ error: "Paystack could not confirm this payment." }, { status: 422 });

    const result = await applySchoolFeePayment(service, txn, { invoiceId, studentId: student.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ...result, verified: true });
  } catch (error: any) {
    console.error("Paystack verification error:", error);
    const notConfigured = /not configured/i.test(error?.message || "");
    return NextResponse.json(
      { error: notConfigured ? error.message : "Payment verification failed." },
      { status: notConfigured ? 503 : 500 }
    );
  }
}
