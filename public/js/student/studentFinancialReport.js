import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getStudentCurrentInvoice, formatCurrency, formatDate } from "/js/shared/schoolFinance.js";

const authLoader = document.getElementById("authLoader");

const reportStatusBadge = document.getElementById("reportStatusBadge");
const repStudentName = document.getElementById("repStudentName");
const repAdmNo = document.getElementById("repAdmNo");
const repClass = document.getElementById("repClass");
const repSessionTerm = document.getElementById("repSessionTerm");

const repTotalFee = document.getElementById("repTotalFee");
const repPaid = document.getElementById("repPaid");
const repBalance = document.getElementById("repBalance");
const repLedgerBody = document.getElementById("repLedgerBody");

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

    await loadFinancialReport(student.id);
  } catch (err) {
    console.error("Financial report error:", err);
    alert(err?.message || "Failed to load financial report.");
  }
}

async function loadFinancialReport(studentId) {
  const financeData = await getStudentCurrentInvoice(studentId);
  if (!financeData) return;

  const {
    student,
    session,
    termName,
    className,
    totalAmount,
    amountPaid,
    outstandingBalance,
    status,
    paymentRecords
  } = financeData;

  repStudentName.textContent = student.name;
  repAdmNo.textContent = student.admission_no;
  repClass.textContent = className;
  repSessionTerm.textContent = `${session} • ${termName}`;

  repTotalFee.textContent = formatCurrency(totalAmount);
  repPaid.textContent = formatCurrency(amountPaid);
  repBalance.textContent = formatCurrency(outstandingBalance);

  let badgeClass = "bg-rose-100 text-rose-800 border-rose-200";
  if (status === "FULLY PAID") badgeClass = "bg-emerald-100 text-emerald-800 border-emerald-200";
  else if (status === "PARTIALLY PAID") badgeClass = "bg-amber-100 text-amber-800 border-amber-200";

  reportStatusBadge.innerHTML = `<span class="px-3.5 py-1.5 rounded-lg border text-xs font-extrabold uppercase tracking-wider ${badgeClass}">${status}</span>`;

  repLedgerBody.innerHTML = "";
  if (!paymentRecords.length) {
    repLedgerBody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-500">No payment transactions recorded for this term statement.</td></tr>`;
    return;
  }

  paymentRecords.forEach(rec => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-2.5 text-slate-600">${formatDate(rec.payment_date)}</td>
      <td class="px-4 py-2.5 font-mono text-slate-800 font-semibold">${rec.payment_reference}</td>
      <td class="px-4 py-2.5 font-mono text-slate-600">${rec.receipt_number || "—"}</td>
      <td class="px-4 py-2.5 text-right font-bold text-slate-900">${formatCurrency(rec.amount)}</td>
    `;
    repLedgerBody.appendChild(tr);
  });
}

init();
