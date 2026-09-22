import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

type PaystackVerification = {
  status: boolean;
  data?: { status?: string; amount?: number; currency?: string; reference?: string };
};

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service, authId } = actor;
  let body: { reference?: string; invoice_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const reference = body.reference?.trim();
  const invoiceId = body.invoice_id?.trim();
  if (!reference || !invoiceId) return NextResponse.json({ error: "Payment reference and invoice are required." }, { status: 400 });
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return NextResponse.json({ error: "Payment verification is not configured." }, { status: 503 });

  const { data: student } = await service.from("students").select("id").eq("user_id", authId).maybeSingle();
  if (!student) return NextResponse.json({ error: "Student profile not found." }, { status: 403 });
  const { data: invoice } = await service
    .from("payment_invoices").select("id, student_id, total_amount").eq("id", invoiceId).eq("student_id", student.id).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "The selected invoice is unavailable." }, { status: 404 });

  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` }, cache: "no-store",
    });
    const verification = (await response.json()) as PaystackVerification;
    const transaction = verification.data;
    if (!response.ok || !verification.status || transaction?.status !== "success" || transaction.currency !== "NGN") {
      return NextResponse.json({ error: "Paystack could not confirm this payment." }, { status: 422 });
    }
    const amount = Number(transaction.amount || 0) / 100;
    if (!Number.isFinite(amount) || amount <= 0 || transaction.reference !== reference) {
      return NextResponse.json({ error: "The payment details returned by Paystack are invalid." }, { status: 422 });
    }
    const { data: existing } = await service.from("payment_records").select("id, receipt_number").eq("payment_reference", reference).maybeSingle();
    if (existing) return NextResponse.json({ ok: true, verified: true, receipt_number: existing.receipt_number });

    const receiptNumber = `REC-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const { error: recordError } = await service.from("payment_records").insert({
      invoice_id: invoice.id, student_id: student.id, payment_reference: reference, receipt_number: receiptNumber,
      amount, payment_gateway: "paystack", status: "successful", payment_date: new Date().toISOString(), verified_at: new Date().toISOString(),
    });
    if (recordError) throw recordError;

    const { data: records } = await service.from("payment_records").select("amount").eq("invoice_id", invoice.id).in("status", ["successful", "success"]);
    const totalPaid = (records || []).reduce((total, record) => total + Number(record.amount || 0), 0);
    const balance = Math.max(0, Number(invoice.total_amount || 0) - totalPaid);
    const status = balance <= 0 && Number(invoice.total_amount || 0) > 0 ? "FULLY PAID" : "PARTIALLY PAID";
    await service.from("payment_invoices").update({ amount_paid: totalPaid, status }).eq("id", invoice.id);
    if (status === "FULLY PAID") {
      const { data: policy } = await service.from("portal_access_settings").select("auto_unlock_on_full_payment").limit(1).maybeSingle();
      if (policy?.auto_unlock_on_full_payment !== false) {
        await service.from("students").update({ portal_access_status: "ACTIVE", portal_lock_reason: null }).eq("id", student.id);
      }
    }
    return NextResponse.json({ ok: true, verified: true, receipt_number: receiptNumber, amount_paid: totalPaid, outstanding_balance: balance, status });
  } catch (error) {
    console.error("Paystack verification error:", error);
    return NextResponse.json({ error: "Payment verification failed." }, { status: 500 });
  }
}
