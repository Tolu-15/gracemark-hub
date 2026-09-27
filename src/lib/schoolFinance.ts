import { getAuthHeaders } from "./supabase/client";
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
  const res = await fetch("/api/paystack-config");
  const data = res.ok ? await res.json().catch(() => null) : null;
  const key: string = data?.public_key || "";
  if (!key || key.includes("your_paystack") || key.includes("placeholder")) {
    throw new Error("Online payment is not available right now. Please contact the school.");
  }
  return key;
}

/**
 * Current invoice, fee structure and paid totals for a student. Built on the server
 * (which also creates/syncs the invoice); the browser never writes finance data.
 */
export async function getStudentCurrentInvoice(studentId: string) {
  if (!studentId) return null;
  try {
    const res = await fetch(`/api/student/finance?student_id=${encodeURIComponent(studentId)}`, {
      headers: await getAuthHeaders(),
      cache: "no-store",
    });
    const json = await res.json();
    return json.ok ? json.finance : null;
  } catch (err) {
    console.error("Finance load error:", err);
    return null;
  }
}

/** Applies the school's fee-lock policy on the server and reports whether the portal is locked. */
export async function evaluateStudentPortalAccess(studentId: string) {
  try {
    const res = await fetch(`/api/student/finance?student_id=${encodeURIComponent(studentId)}&evaluate=1`, {
      headers: await getAuthHeaders(),
      cache: "no-store",
    });
    const json = await res.json();
    return json.ok ? { isLocked: Boolean(json.isLocked), reason: json.reason ?? null } : { isLocked: false };
  } catch (err) {
    console.error("Portal access evaluation error:", err);
    return { isLocked: false };
  }
}

/** All invoices and successful payments for the signed-in student (server-built). */
export async function getStudentHistory(studentId: string): Promise<{ invoices: any[]; payments: any[] }> {
  try {
    const res = await fetch(`/api/student/finance?student_id=${encodeURIComponent(studentId)}&history=1`, {
      headers: await getAuthHeaders(),
      cache: "no-store",
    });
    const json = await res.json();
    return json.ok ? { invoices: json.invoices || [], payments: json.payments || [] } : { invoices: [], payments: [] };
  } catch (err) {
    console.error("Payment history load error:", err);
    return { invoices: [], payments: [] };
  }
}
