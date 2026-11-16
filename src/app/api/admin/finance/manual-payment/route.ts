import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { buildStudentFinance, evaluatePortalAccess, newReceiptNumber } from "@/lib/financeServer";
import { randomUUID } from "crypto";

/** Admin records a cash / bank-transfer payment against a student's current invoice. */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service, dbUserId } = authorization.actor;

  const body = await req.json().catch(() => null);
  const studentId = String(body?.student_id || "");
  const amount = Number(body?.amount);
  const key = req.headers.get("Idempotency-Key");
  if (key !== null && !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(key)) {
    return NextResponse.json({ ok: false, error: "Invalid payment request identifier." }, { status: 400 });
  }
  if (!studentId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: "A student and a positive amount are required." }, { status: 400 });
  }

  try {
    const fin = await buildStudentFinance(service, studentId);
    if (!fin) return NextResponse.json({ ok: false, error: "Student not found." }, { status: 404 });
    if (!fin.invoice) {
      return NextResponse.json(
        { ok: false, error: "This student has no invoice yet. Set up a fee structure for their class and term first." },
        { status: 409 }
      );
    }
    if (fin.invoice.status === "cancelled") {
      return NextResponse.json({ ok: false, error: "This invoice is cancelled." }, { status: 409 });
    }

    let receipt = newReceiptNumber();
    const reference = `MAN-${key || randomUUID()}`;
    const { error } = await service.from("payment_transactions").insert({
      invoice_id: fin.invoice.id,
      payment_reference: reference,
      receipt_number: receipt,
      amount,
      gateway: "manual",
      gateway_response: { method: String(body?.method || "cash"), notes: String(body?.notes || "").slice(0, 500) },
      status: "success",
      paid_at: new Date().toISOString(),
      verified_by: dbUserId || null,
    });
    if (error) {
      if (!key || error.code !== "23505") throw error;
      const { data: prior } = await service.from("payment_transactions")
        .select("invoice_id, amount, receipt_number, verified_by, gateway, status, gateway_response")
        .eq("payment_reference", reference).maybeSingle();
      if (!prior || prior.invoice_id !== fin.invoice.id || Number(prior.amount) !== amount ||
          prior.verified_by !== dbUserId || prior.gateway !== "manual" || prior.status !== "success" ||
          prior.gateway_response?.method !== String(body?.method || "cash") ||
          prior.gateway_response?.notes !== String(body?.notes || "").slice(0, 500)) {
        return NextResponse.json({ ok: false, error: "Payment request conflicts with an existing receipt." }, { status: 409 });
      }
      receipt = prior.receipt_number;
    }

    await evaluatePortalAccess(service, studentId);
    const after = await buildStudentFinance(service, studentId);
    return NextResponse.json({ ok: true, receipt_number: receipt, outstanding_balance: after?.outstandingBalance ?? null });
  } catch (err: any) {
    console.error("manual payment error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Could not record payment." }, { status: 500 });
  }
}
