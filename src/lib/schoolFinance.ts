import { getSupabaseBrowserClient } from "./supabase/client";
import { getAppSettings } from "./appSettings";

export function formatCurrency(amount: number | string | null | undefined): string {
  const num = Number(amount || 0);
  return (
    "NGN " +
    num.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "-";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return String(dateString);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export type CanonicalPaymentStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "cancelled";

export function formatPaymentStatus(status: string | null | undefined): string {
  const s = String(status || "").toLowerCase();
  if (s === "paid" || s === "fully paid") return "FULLY PAID";
  if (s === "partially_paid" || s === "partially paid") return "PARTIALLY PAID";
  if (s === "overdue") return "OVERDUE";
  if (s === "cancelled") return "CANCELLED";
  if (s === "draft") return "DRAFT";
  return "UNPAID";
}

export function calculatePaymentStatus(totalAmount: number, amountPaid: number, dueDate?: string | null): CanonicalPaymentStatus {
  const total = Number(totalAmount || 0);
  const paid = Number(amountPaid || 0);
  const balance = Math.max(0, total - paid);

  if (balance <= 0 && total > 0) return "paid";
  if (paid > 0 && balance > 0) return "partially_paid";
  if (dueDate && new Date(dueDate).getTime() < Date.now()) return "overdue";
  return "issued";
}

export async function getCurrentAcademicSessionAndTerm() {
  const settings = await getAppSettings();
  const session = settings?.current_session || "";
  const termCode = settings?.current_term || "term1";
  const termName =
    termCode === "term1" ? "First Term" : termCode === "term2" ? "Second Term" : "Third Term";

  return { session, termCode, termName };
}

export async function getPaystackPublicKey(): Promise<string> {
  try {
    const res = await fetch("/api/paystack-config");
    if (res.ok) {
      const data = await res.json();
      if (data?.public_key && !data.public_key.includes("your_paystack")) return data.public_key;
    }
  } catch (e) {
    console.warn("Paystack config API fetch:", e);
  }

  const supabase = getSupabaseBrowserClient();
  try {
    const { data: config } = await supabase
      .from("payment_config")
      .select("public_key")
      .eq("enabled", true)
      .maybeSingle();
    if (config?.public_key) return config.public_key;
  } catch (e) {}

  return (
    process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ||
    "pk_test_1b7ffdcc47fc414286a6637e7edcb0483659d2e7"
  );
}

function feeTotal(feeStructure: any) {
  if (!feeStructure) return 0;
  return (
    Number(feeStructure.tuition_amount || 0) +
    Number(feeStructure.registration_fee || 0) +
    Number(feeStructure.exams_fee || 0) +
    Number(feeStructure.facilities_fee || 0)
  );
}

export async function getStudentCurrentInvoice(studentId: string) {
  if (!studentId) return null;
  const supabase = getSupabaseBrowserClient();

  const { data: sData } = await supabase
    .from("students")
    .select("id, name, admission_no, class_id, portal_access_status, portal_lock_reason, classes:class_id(name)")
    .eq("id", studentId)
    .maybeSingle();

  const student = sData || {
    id: studentId,
    name: "Student",
    admission_no: "STD-001",
    class_id: null,
    portal_access_status: "ACTIVE",
    classes: null,
  };

  let className = (student.classes as any)?.name || "Unassigned";
  if (!(student.classes as any)?.name && student.class_id) {
    const { data: cData } = await supabase
      .from("classes")
      .select("name")
      .eq("id", student.class_id)
      .maybeSingle();
    if (cData?.name) className = cData.name;
  }

  const { session, termCode, termName } = await getCurrentAcademicSessionAndTerm();
  const classId = student.class_id;

  let feeStructure: any = null;
  if (classId) {
    const { data: exactFee } = await supabase
      .from("fee_structures")
      .select("*")
      .eq("class_id", classId)
      .eq("status", "active")
      .eq("academic_session", session)
      .or(`term.eq.${termCode},term.eq.${termName}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    feeStructure = exactFee;

    if (!feeStructure) {
      const { data: fallbackFee } = await supabase
        .from("fee_structures")
        .select("*")
        .eq("class_id", classId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      feeStructure = fallbackFee;
    }
  }

  const expectedFee = feeTotal(feeStructure);

  const { data: allInvoices } = await supabase
    .from("payment_invoices")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });

  let invoice: any = null;
  if (allInvoices?.length) {
    invoice =
      allInvoices.find(
        (inv: any) =>
          inv.academic_session === session && (inv.term === termCode || inv.term === termName)
      ) || allInvoices[0];
  }

  if (invoice && expectedFee > 0 && Number(invoice.total_amount || 0) < expectedFee) {
    const { data: correctedInvoice, error: correctErr } = await supabase
      .from("payment_invoices")
      .update({
        total_amount: expectedFee,
        fee_structure_id: feeStructure?.id || invoice.fee_structure_id || null,
        class_id: classId || invoice.class_id || null,
        academic_session: invoice.academic_session || feeStructure?.academic_session || session,
        term: invoice.term || feeStructure?.term || termCode,
      })
      .eq("id", invoice.id)
      .select()
      .maybeSingle();

    if (!correctErr && correctedInvoice) invoice = correctedInvoice;
  }

  if (!invoice && expectedFee > 0) {
    const invSession = feeStructure?.academic_session || session;
    const invTerm = feeStructure?.term || termCode;
    const invoiceNumber = `INV-${invSession.replace(/\//g, "")}-${String(invTerm).toUpperCase()}-${Math.floor(
      1000 + Math.random() * 9000
    )}`;

    const { data: newInv, error: invErr } = await supabase
      .from("payment_invoices")
      .insert([
        {
          student_id: studentId,
          fee_structure_id: feeStructure?.id || null,
          class_id: classId,
          academic_session: invSession,
          term: invTerm,
          total_amount: expectedFee,
          amount_paid: 0,
          status: "issued",
          invoice_number: invoiceNumber,
        },
      ])
      .select()
      .maybeSingle();

    if (!invErr && newInv) {
      invoice = newInv;
    } else if (invErr) {
      const { data: existingInv } = await supabase
        .from("payment_invoices")
        .select("*")
        .eq("student_id", studentId)
        .eq("academic_session", invSession)
        .or(`term.eq.${invTerm},term.eq.${termName}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingInv) invoice = existingInv;
    }
  }

  let verifiedPaid = 0;
  let paymentRecords: any[] = [];
  if (invoice?.id) {
    const { data: pRecords } = await supabase
      .from("payment_records")
      .select("*")
      .eq("invoice_id", invoice.id)
      .in("status", ["successful", "success"])
      .order("payment_date", { ascending: false });

    paymentRecords = pRecords || [];
    verifiedPaid = paymentRecords.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
  }

  const totalAmount = invoice ? Number(invoice.total_amount || 0) : expectedFee;
  const balance = Math.max(0, totalAmount - verifiedPaid);
  const status = calculatePaymentStatus(totalAmount, verifiedPaid);

  if (invoice && (Number(invoice.amount_paid || 0) !== verifiedPaid || invoice.status !== status)) {
    await supabase
      .from("payment_invoices")
      .update({ amount_paid: verifiedPaid, status })
      .eq("id", invoice.id);
  }

  return {
    student,
    session,
    termCode,
    termName,
    className,
    feeStructure,
    invoice,
    totalAmount,
    amountPaid: verifiedPaid,
    outstandingBalance: balance,
    status,
    paymentRecords,
  };
}

export async function evaluateStudentPortalAccess(studentId: string) {
  const supabase = getSupabaseBrowserClient();
  try {
    const { data: policy } = await supabase
      .from("portal_access_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!policy || !policy.restrict_outstanding_fees) {
      return { isLocked: false, reason: "Restriction policy disabled" };
    }

    const financeData = await getStudentCurrentInvoice(studentId);
    if (!financeData) return { isLocked: false };

    const { outstandingBalance, status, student } = financeData;

    if (outstandingBalance <= 0) {
      if (policy.auto_unlock_on_full_payment && student.portal_access_status === "LOCKED") {
        await supabase
          .from("students")
          .update({
            portal_access_status: "ACTIVE",
            portal_lock_reason: null,
          })
          .eq("id", studentId);
      }
      return { isLocked: false };
    }

    if (student.portal_access_status !== "LOCKED") {
      const lockReason = `Automatic lock: Outstanding balance of ${formatCurrency(
        outstandingBalance
      )} (${status})`;
      await supabase
        .from("students")
        .update({
          portal_access_status: "LOCKED",
          portal_lock_reason: lockReason,
          portal_locked_at: new Date().toISOString(),
        })
        .eq("id", studentId);

      return { isLocked: true, reason: lockReason };
    }

    return { isLocked: true, reason: (student as any).portal_lock_reason || null };
  } catch (err) {
    console.error("Portal access evaluation error:", err);
    return { isLocked: false };
  }
}
