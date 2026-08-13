import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { formatCurrency, formatDate } from "/js/shared/schoolFinance.js";

const authLoader = document.getElementById("authLoader");
const historyTableBody = document.getElementById("historyTableBody");

async function findStudentForUser(user) {
  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (student) return student;

  const { data: altStudent } = await supabase
    .from("students")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  return altStudent;
}

async function init() {
  try {
    const ok = await requireRole("student", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";

    const student = await findStudentForUser(ok.user);

    if (!student) throw new Error("Student profile not found.");

    await loadPaymentHistory(student.id);
  } catch (err) {
    console.error("Payment history error:", err);
    alert(err?.message || "Failed to load payment history.");
  }
}

async function loadPaymentHistory(studentId) {
  historyTableBody.innerHTML = "";

  const { data: records, error } = await supabase
    .from("payment_records")
    .select("*, payment_invoices(academic_session, term)")
    .eq("student_id", studentId)
    .order("payment_date", { ascending: false });

  if (error) {
    console.error("Error loading payment history:", error);
    historyTableBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-rose-500">Failed to load payment history.</td></tr>`;
    return;
  }

  if (!records || !records.length) {
    historyTableBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-500">No verified payment transactions found.</td></tr>`;
    return;
  }

  records.forEach(rec => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 transition-colors";

    const session = rec.payment_invoices?.academic_session || "2026/2027";
    const term = rec.payment_invoices?.term || "term1";
    const termDisplay = term === "term1" ? "1st Term" : term === "term2" ? "2nd Term" : term === "term3" ? "3rd Term" : term;

    const isSuccess = rec.status === "successful" || rec.status === "success";
    const badgeClass = isSuccess ? "bg-emerald-50 text-emerald-700 font-semibold" : "bg-amber-50 text-amber-700 font-semibold";

    tr.innerHTML = `
      <td class="px-5 py-3.5 text-slate-600">${formatDate(rec.payment_date)}</td>
      <td class="px-5 py-3.5 font-mono text-slate-900 font-semibold">${rec.payment_reference}</td>
      <td class="px-5 py-3.5 text-slate-600">${session} • ${termDisplay}</td>
      <td class="px-5 py-3.5 font-mono text-slate-700">${rec.receipt_number || "—"}</td>
      <td class="px-5 py-3.5 text-right font-bold text-slate-900">${formatCurrency(rec.amount)}</td>
      <td class="px-5 py-3.5 text-center"><span class="px-2.5 py-1 rounded text-[11px] ${badgeClass}">${isSuccess ? "Successful" : rec.status}</span></td>
    `;
    historyTableBody.appendChild(tr);
  });
}

init();
