import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { reference, invoice_id: raw_invoice_id, student_id, amount, invoice: invoice_context } = body || {};
  let resolvedInvoiceId = raw_invoice_id;

  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ error: "Server service role not configured." }, { status: 503 });
  }

  try {
    let { data: targetInvoice } = resolvedInvoiceId
      ? await service.from("payment_invoices").select("*").eq("id", resolvedInvoiceId).maybeSingle()
      : { data: null };

    const invoiceContext = invoice_context || {};
    const contextSession =
      invoiceContext.academic_session || `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`;
    const contextTerm = invoiceContext.term || "term1";

    if (!targetInvoice && student_id) {
      let invoiceQuery = service
        .from("payment_invoices")
        .select("*")
        .eq("student_id", student_id)
        .eq("academic_session", contextSession);

      if (contextTerm) invoiceQuery = invoiceQuery.eq("term", contextTerm);

      const { data: matchingInvoices } = await invoiceQuery
        .order("created_at", { ascending: false })
        .limit(1);

      const stdInv = matchingInvoices?.[0] || null;

      if (stdInv) {
        targetInvoice = stdInv;
        resolvedInvoiceId = stdInv.id;
      } else {
        const invoiceNumber = `INV-${contextSession.replace(/\//g, "")}-${String(contextTerm).toUpperCase()}-${Date.now()}`;
        const { data: newInv, error: newInvErr } = await service
          .from("payment_invoices")
          .insert([
            {
              student_id,
              fee_structure_id: invoiceContext.fee_structure_id || null,
              class_id: invoiceContext.class_id || null,
              total_amount: Number(invoiceContext.total_amount || amount || 0),
              amount_paid: 0,
              academic_session: contextSession,
              term: contextTerm,
              status: "UNPAID",
              invoice_number: invoiceNumber,
            },
          ])
          .select()
          .maybeSingle();

        if (newInv) {
          targetInvoice = newInv;
          resolvedInvoiceId = newInv.id;
        } else if (newInvErr) {
          throw newInvErr;
        }
      }
    }

    // 1. Check if reference has already been processed
    const { data: existingRec } = await service
      .from("payment_records")
      .select("id, status, receipt_number")
      .eq("payment_reference", reference)
      .maybeSingle();

    if (existingRec && (existingRec.status === "successful" || existingRec.status === "success")) {
      return NextResponse.json({
        ok: true,
        verified: true,
        message: "Payment reference already verified.",
        receipt_number: existingRec.receipt_number,
      });
    }

    const invoice_id = resolvedInvoiceId;
    if (!invoice_id) {
      throw new Error("Could not resolve or create a payment invoice.");
    }

    // 2. Generate unique receipt number
    const year = new Date().getFullYear();
    const receiptNumber = `REC-${year}-${Math.floor(100000 + Math.random() * 900000)}`;

    // 3. Upsert payment record as verified successful
    const { error: recErr } = await service
      .from("payment_records")
      .upsert(
        {
          invoice_id,
          student_id: student_id || null,
          payment_reference: reference,
          receipt_number: receiptNumber,
          amount: Number(amount || 0),
          payment_gateway: "paystack",
          status: "successful",
          payment_date: new Date().toISOString(),
          verified_at: new Date().toISOString(),
        },
        { onConflict: "payment_reference" }
      )
      .select()
      .single();

    if (recErr) throw recErr;

    // 4. Recalculate invoice total verified paid & status
    const { data: records } = await service
      .from("payment_records")
      .select("amount")
      .eq("invoice_id", invoice_id)
      .in("status", ["successful", "success"]);

    const totalPaid = (records || []).reduce((s, r) => s + Number(r.amount || 0), 0);

    const { data: invoice } = await service
      .from("payment_invoices")
      .select("total_amount")
      .eq("id", invoice_id)
      .single();

    const totalAmount = Number(invoice?.total_amount || 0);
    const balance = Math.max(0, totalAmount - totalPaid);
    let newStatus = "UNPAID";
    if (balance <= 0 && totalAmount > 0) newStatus = "FULLY PAID";
    else if (totalPaid > 0) newStatus = "PARTIALLY PAID";

    await service
      .from("payment_invoices")
      .update({ amount_paid: totalPaid, status: newStatus })
      .eq("id", invoice_id);

    // 5. Evaluate portal access if student fully paid
    if (student_id && newStatus === "FULLY PAID") {
      const { data: policy } = await service
        .from("portal_access_settings")
        .select("auto_unlock_on_full_payment")
        .limit(1)
        .maybeSingle();

      if (policy?.auto_unlock_on_full_payment !== false) {
        await service.from("students").update({
          portal_access_status: "ACTIVE",
          portal_lock_reason: null,
        }).eq("id", student_id);
      }
    }

    return NextResponse.json({
      ok: true,
      verified: true,
      receipt_number: receiptNumber,
      amount_paid: totalPaid,
      outstanding_balance: balance,
      status: newStatus,
    });
  } catch (error: any) {
    console.error("Payment Verification Error:", error);
    return NextResponse.json(
      { error: error.message || "Payment verification failed." },
      { status: 500 }
    );
  }
}
