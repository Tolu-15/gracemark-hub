import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYMENTS_ENABLED } from "./features";
import { calculatePaymentStatus, formatCurrency, formatPaymentStatus } from "./schoolFinance";

/**
 * Server-only finance logic for the canonical schema:
 *   fee_structures -> payment_invoices (per enrollment) -> payment_transactions
 *   admission_forms -> admission_payments / admissions
 * Every write happens here with the service-role client; browsers only read.
 * A database trigger keeps payment_invoices.amount_paid/status in step with
 * payment_transactions rows whose status is 'success'.
 */

/** Reference prefixes keep the payment flows from being replayed against each other. */
export const REF_PREFIX = { fees: "GMF", admission: "GMA" } as const;

export function newReference(prefix: (typeof REF_PREFIX)[keyof typeof REF_PREFIX]) {
  return `${prefix}-${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

export function newReceiptNumber() {
  return `REC-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

const TERM_NAMES: Record<string, string> = { term1: "First Term", term2: "Second Term", term3: "Third Term" };

export async function getCurrentSessionAndTerm(service: SupabaseClient) {
  const { data: settings } = await service.from("app_settings").select("*").limit(1).maybeSingle();
  let sessionId: string | null = (settings as any)?.current_session_id || null;
  let session: { id: string; name: string } | null = null;

  if (sessionId) {
    const { data } = await service.from("academic_sessions").select("id, name").eq("id", sessionId).maybeSingle();
    if (data) session = data as any;
  }
  if (!session) {
    const { data } = await service.from("academic_sessions").select("id, name").eq("status", "active").limit(1).maybeSingle();
    if (data) session = data as any;
  }
  const termCode: string = (settings as any)?.current_term || "term1";
  return { sessionId: session?.id || null, session: session?.name || "", termCode, termName: TERM_NAMES[termCode] || "First Term" };
}

/** The student's fee-lock state, tolerant of enum casing. */
const isLockedValue = (v: unknown) => String(v || "").toLowerCase() === "locked";

/**
 * Finds (or creates) the student's invoice for the current term and returns everything the
 * fee pages need. Shapes are kept close to what the pages already read.
 */
export async function buildStudentFinance(service: SupabaseClient, studentId: string) {
  const { data: sData } = await service.from("students").select("*").eq("id", studentId).maybeSingle();
  if (!sData) return null;

  const { sessionId, session, termCode, termName } = await getCurrentSessionAndTerm(service);

  // Enrollment for the current session decides the class the fee applies to.
  let enrollment: any = null;
  if (sessionId) {
    const { data } = await service
      .from("student_enrollments").select("id, class_id")
      .eq("student_id", studentId).eq("academic_session_id", sessionId).eq("status", "active")
      .limit(1).maybeSingle();
    enrollment = data;
  }
  const classId: string | null = enrollment?.class_id || (sData as any).current_class_id || (sData as any).class_id || null;

  let className = "Unassigned";
  if (classId) {
    const { data: c } = await service.from("classes").select("name").eq("id", classId).maybeSingle();
    if (c?.name) className = c.name;
  }

  const student = {
    id: sData.id,
    name: (sData as any).full_name || (sData as any).name || "Student",
    admission_no: (sData as any).admission_no,
    class_id: classId,
    portal_access_status: (sData as any).portal_access_status,
    portal_lock_reason: (sData as any).portal_lock_reason,
    classes: { name: className },
  };

  // Fee schedule for this class / session / term.
  let fee: any = null;
  if (classId && sessionId) {
    const { data } = await service
      .from("fee_structures").select("*")
      .eq("class_id", classId).eq("academic_session_id", sessionId).eq("term", termCode)
      .limit(1).maybeSingle();
    fee = data;
  }
  const expectedFee = Number(fee?.total_amount || 0);

  // Invoice for that schedule; create it on first look.
  let invoice: any = null;
  if (enrollment && fee) {
    const { data } = await service
      .from("payment_invoices").select("*").eq("enrollment_id", enrollment.id).eq("fee_structure_id", fee.id).limit(1).maybeSingle();
    invoice = data;

    if (!invoice && expectedFee > 0) {
      const { data: created, error } = await service
        .from("payment_invoices")
        .insert({
          invoice_number: `INV-${session.replace(/\//g, "")}-${termCode.toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`,
          enrollment_id: enrollment.id,
          student_id: studentId,
          fee_structure_id: fee.id,
          total_amount: expectedFee,
          due_date: fee.due_date || null,
        })
        .select().maybeSingle();
      if (created) invoice = created;
      else if (error) {
        // Lost a race with a concurrent request creating the same invoice.
        const { data: again } = await service
          .from("payment_invoices").select("*").eq("enrollment_id", enrollment.id).eq("fee_structure_id", fee.id).limit(1).maybeSingle();
        invoice = again;
      }
    }

    // The schedule was raised after the invoice was issued.
    if (invoice && invoice.status !== "cancelled" && Number(invoice.total_amount) < expectedFee) {
      const { data: bumped } = await service
        .from("payment_invoices").update({ total_amount: expectedFee }).eq("id", invoice.id).select().maybeSingle();
      if (bumped) invoice = bumped;
    }
  }

  // No invoice for this term: fall back to the student's latest one (e.g. arrears).
  if (!invoice) {
    const { data } = await service
      .from("payment_invoices").select("*").eq("student_id", studentId).neq("status", "cancelled")
      .order("issued_at", { ascending: false }).limit(1).maybeSingle();
    invoice = data;
  }

  let paymentRecords: any[] = [];
  let paid = 0;
  if (invoice?.id) {
    const { data: txs } = await service
      .from("payment_transactions").select("*").eq("invoice_id", invoice.id).eq("status", "success")
      .order("paid_at", { ascending: false });
    paymentRecords = (txs || []).map((t: any) => ({ ...t, payment_date: t.paid_at, payment_gateway: t.gateway }));
    paid = paymentRecords.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  }

  const totalAmount = invoice ? Number(invoice.total_amount || 0) : expectedFee;
  const outstandingBalance = Math.max(0, totalAmount - paid);
  const canonical = invoice?.status === "cancelled" ? "cancelled" : calculatePaymentStatus(totalAmount, paid, invoice?.due_date);

  return {
    student, session, termCode, termName, className,
    feeStructure: fee
      ? { ...fee, facilities_fee: Number(fee.development_levy || 0), exams_fee: Number(fee.exam_levy || 0) }
      : null,
    invoice: invoice ? { ...invoice, academic_session: session, term: termName } : null,
    totalAmount, amountPaid: paid, outstandingBalance,
    status: formatPaymentStatus(canonical),
    statusCode: canonical,
    paymentRecords,
  };
}

/** Every invoice and successful payment for a student, shaped for the history / receipt / report pages. */
export async function getStudentHistory(service: SupabaseClient, studentId: string) {
  const { data: sData } = await service.from("students").select("*").eq("id", studentId).maybeSingle();
  const cid = (sData as any)?.current_class_id || (sData as any)?.class_id;
  let className = "Unassigned";
  if (cid) {
    const { data: c } = await service.from("classes").select("name").eq("id", cid).maybeSingle();
    if (c?.name) className = c.name;
  }
  const student = {
    id: studentId,
    name: (sData as any)?.full_name || (sData as any)?.name || "Student",
    admission_no: (sData as any)?.admission_no,
    classes: { name: className },
  };

  const { data: rows } = await service
    .from("payment_invoices")
    .select("*, fee_structures(term, academic_sessions(name)), payment_transactions(*)")
    .eq("student_id", studentId)
    .order("issued_at", { ascending: false });

  const one = (v: any) => (Array.isArray(v) ? v[0] : v);
  const invoices: any[] = [];
  const payments: any[] = [];

  for (const row of rows || []) {
    const fee = one((row as any).fee_structures);
    const sessionName = one(fee?.academic_sessions)?.name || "";
    const termName = TERM_NAMES[fee?.term] || fee?.term || "";
    const { fee_structures: _f, payment_transactions: txs, ...inv } = row as any;
    const invoice = { ...inv, academic_session: sessionName, term: termName, created_at: inv.issued_at };

    const mapped = (txs || []).map((t: any) => ({
      ...t,
      reference: t.payment_reference,
      payment_date: t.paid_at,
      payment_gateway: t.gateway,
      created_at: t.paid_at,
      payment_invoices: invoice,
      students: student,
    }));
    invoices.push({ ...invoice, payment_records: mapped });
    payments.push(...mapped.filter((t: any) => t.status === "success"));
  }
  payments.sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)));
  return { invoices, payments };
}

/** Applies the school's fee-lock policy to a student and returns whether the portal is locked. */
export async function evaluatePortalAccess(service: SupabaseClient, studentId: string) {
  // Fee-based auto lock/unlock is off while payments are disabled; admin locks still apply.
  if (!PAYMENTS_ENABLED) return { isLocked: false, reason: null as string | null };

  const { data: policy } = await service.from("portal_access_settings").select("*").limit(1).maybeSingle();
  if (!policy || !policy.restrict_outstanding_fees) return { isLocked: false, reason: null as string | null };

  const fin = await buildStudentFinance(service, studentId);
  if (!fin) return { isLocked: false, reason: null };

  const locked = isLockedValue(fin.student.portal_access_status);

  // Nothing billed yet: never lock on an empty invoice.
  if (fin.outstandingBalance <= 0) {
    if (policy.auto_unlock_on_full_payment && locked && fin.totalAmount > 0) {
      await service.from("students").update({ portal_access_status: "active", portal_lock_reason: null }).eq("id", studentId);
      return { isLocked: false, reason: null };
    }
    return { isLocked: locked && fin.totalAmount <= 0, reason: locked ? fin.student.portal_lock_reason || null : null };
  }

  if (!locked) {
    const reason = `Automatic lock: Outstanding balance of ${formatCurrency(fin.outstandingBalance)} (${fin.status})`;
    await service.from("students").update({ portal_access_status: "locked", portal_lock_reason: reason }).eq("id", studentId);
    return { isLocked: true, reason };
  }
  return { isLocked: true, reason: fin.student.portal_lock_reason || null };
}

/* -------------------------------------------------------------------------- */
/* Paystack                                                                    */
/* -------------------------------------------------------------------------- */

export interface PaystackTransaction {
  status?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  metadata?: Record<string, any> | null;
}

/** Public key from env, else the active Paystack row in payment_gateway_configs. */
export async function getPaystackPublicKey(service: SupabaseClient | null): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || process.env.PAYSTACK_PUBLIC_KEY || "";
  if (fromEnv) return fromEnv;
  if (!service) return "";
  const { data } = await service.from("payment_gateway_configs").select("public_key").eq("gateway", "paystack").eq("is_active", true).limit(1).maybeSingle();
  return (data as any)?.public_key || "";
}

/** Asks Paystack (never the browser) whether a reference was really paid. Returns null if it was not. */
export async function verifyPaystackReference(reference: string): Promise<PaystackTransaction | null> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new Error("Payment verification is not configured.");

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { status?: boolean; data?: PaystackTransaction } | null;
  const txn = json?.data;
  if (!res.ok || !json?.status || !txn || txn.status !== "success" || txn.currency !== "NGN" || txn.reference !== reference) {
    return null;
  }
  return txn;
}

const meta = (txn: PaystackTransaction, key: string) => {
  const v = (txn.metadata || {})[key];
  return v != null ? String(v) : "";
};

const gatewayResponse = (txn: PaystackTransaction) => ({
  status: txn.status, amount: txn.amount, currency: txn.currency, reference: txn.reference,
});

/** Records a verified school-fee payment against an invoice. Safe to call repeatedly for the same reference. */
export async function applySchoolFeePayment(
  service: SupabaseClient,
  txn: PaystackTransaction,
  expected?: { invoiceId?: string; studentId?: string }
) {
  const reference = txn.reference!;
  const invoiceId = expected?.invoiceId || meta(txn, "invoice_id");
  if (!reference.startsWith(`${REF_PREFIX.fees}-`) || !invoiceId) {
    return { ok: false as const, status: 422, error: "This payment is not a school-fee payment." };
  }
  if (meta(txn, "invoice_id") && meta(txn, "invoice_id") !== invoiceId) {
    return { ok: false as const, status: 422, error: "Payment does not match this invoice." };
  }

  const { data: invoice } = await service.from("payment_invoices").select("id, student_id, status").eq("id", invoiceId).maybeSingle();
  if (!invoice) return { ok: false as const, status: 404, error: "The selected invoice is unavailable." };
  if (expected?.studentId && invoice.student_id !== expected.studentId) {
    return { ok: false as const, status: 403, error: "This invoice does not belong to you." };
  }
  if (invoice.status === "cancelled") {
    return { ok: false as const, status: 409, error: "This invoice has been cancelled. Please contact the school." };
  }

  const amount = Number(txn.amount || 0) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false as const, status: 422, error: "The payment details returned by Paystack are invalid." };
  }

  const { data: existing } = await service
    .from("payment_transactions").select("id, invoice_id, receipt_number").eq("payment_reference", reference).maybeSingle();
  if (existing && existing.invoice_id !== invoice.id) {
    return { ok: false as const, status: 409, error: "This payment reference was already used." };
  }

  let receiptNumber = existing?.receipt_number as string | undefined;
  if (!existing) {
    receiptNumber = newReceiptNumber();
    const { error } = await service.from("payment_transactions").insert({
      invoice_id: invoice.id, payment_reference: reference, receipt_number: receiptNumber, amount,
      gateway: "paystack", gateway_response: gatewayResponse(txn), status: "success", paid_at: new Date().toISOString(),
    });
    // 23505: a concurrent request (e.g. the webhook) recorded it first, which is fine.
    if (error && (error as any).code !== "23505") throw error;
  }

  // The DB trigger has updated the invoice totals; read them back and apply the lock policy.
  const fin = await buildStudentFinance(service, invoice.student_id);
  await evaluatePortalAccess(service, invoice.student_id);

  return {
    ok: true as const,
    receipt_number: receiptNumber,
    amount_paid: fin?.amountPaid ?? amount,
    outstanding_balance: fin?.outstandingBalance ?? 0,
    status: fin?.status,
  };
}

/* -------------------------------------------------------------------------- */
/* Admissions                                                                  */
/* -------------------------------------------------------------------------- */

/** The admission form currently on sale (active, most recent) with its price. */
export async function getActiveAdmissionForm(service: SupabaseClient) {
  const { sessionId } = await getCurrentSessionAndTerm(service);
  let q = service.from("admission_forms").select("id, name, amount, description, academic_session_id").eq("status", "active").order("created_at", { ascending: false });
  if (sessionId) {
    const { data } = await q.eq("academic_session_id", sessionId).limit(1).maybeSingle();
    if (data) return data as any;
  }
  const { data } = await service.from("admission_forms").select("id, name, amount, description, academic_session_id").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as any) || null;
}

/**
 * Marks an admission payment successful after Paystack confirmed the exact form price, and
 * promotes the linked application from "draft" (unpaid) to "submitted".
 */
export async function applyAdmissionPayment(service: SupabaseClient, txn: PaystackTransaction) {
  const reference = txn.reference!;
  if (!reference.startsWith(`${REF_PREFIX.admission}-`)) {
    return { ok: false as const, status: 422, error: "This payment is not an admission payment." };
  }

  const { data: payment } = await service
    .from("admission_payments").select("id, amount, status").eq("payment_reference", reference).maybeSingle();
  if (!payment) return { ok: false as const, status: 404, error: "No application matches this payment." };

  if (Number(txn.amount || 0) !== Math.round(Number(payment.amount) * 100)) {
    return { ok: false as const, status: 422, error: "The amount paid does not match the application fee." };
  }

  if (payment.status !== "success") {
    const { error } = await service
      .from("admission_payments")
      .update({ status: "success", paid_at: new Date().toISOString(), gateway_response: gatewayResponse(txn) })
      .eq("id", payment.id);
    if (error) throw error;
  }

  const { data: admission } = await service
    .from("admissions").select("id, application_number, status").eq("admission_payment_id", payment.id).maybeSingle();
  if (!admission) return { ok: false as const, status: 404, error: "No application matches this payment." };

  if (admission.status === "draft") {
    const { error } = await service.from("admissions").update({ status: "submitted" }).eq("id", admission.id);
    if (error) throw error;
  }
  return { ok: true as const, application_number: admission.application_number as string };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** The students row that belongs to a signed-in student (user_id may hold either the auth id or users.id). */
export async function findStudentForActor(service: SupabaseClient, authId: string, dbUserId?: string) {
  const ids = Array.from(new Set([authId, dbUserId].filter(Boolean))) as string[];
  const { data } = await service.from("students").select("id").in("user_id", ids).limit(1).maybeSingle();
  return data as { id: string } | null;
}

/** Tiny in-memory limiter for public endpoints (per server instance; a speed bump, not a guarantee). */
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > max;
}
