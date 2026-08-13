import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getStudentCurrentInvoice, formatCurrency } from "/js/shared/schoolFinance.js";

const authLoader = document.getElementById("authLoader");
const lockStudentName = document.getElementById("lockStudentName");
const lockBalanceDisplay = document.getElementById("lockBalanceDisplay");
const lockReasonDisplay = document.getElementById("lockReasonDisplay");

async function init() {
  try {
    const ok = await requireRole("student", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";

    const { data: student } = await supabase
      .from("students")
      .select("id, name, portal_access_status, portal_lock_reason")
      .eq("user_id", ok.user.id)
      .single();

    if (!student) throw new Error("Student record not found.");

    // If student is NOT locked, redirect back to dashboard
    if (student.portal_access_status !== "LOCKED") {
      window.location.replace("/student/dashboard/");
      return;
    }

    lockStudentName.textContent = student.name;
    lockReasonDisplay.textContent = student.portal_lock_reason || "Outstanding school fee balance restriction.";

    const finance = await getStudentCurrentInvoice(student.id);
    if (finance) {
      lockBalanceDisplay.textContent = formatCurrency(finance.outstandingBalance);
    }
  } catch (err) {
    console.error("Student locked view error:", err);
  }
}

init();
