import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { formatCurrency, formatDate } from "/js/shared/schoolFinance.js";

const authLoader = document.getElementById("authLoader");
const receiptsList = document.getElementById("receiptsList");

const receiptModal = document.getElementById("receiptModal");
const btnCloseReceiptModal = document.getElementById("btnCloseReceiptModal");
const btnPrintReceipt = document.getElementById("btnPrintReceipt");

const recNo = document.getElementById("recNo");
const recRef = document.getElementById("recRef");
const recStudentName = document.getElementById("recStudentName");
const recAdmNo = document.getElementById("recAdmNo");
const recClass = document.getElementById("recClass");
const recSessionTerm = document.getElementById("recSessionTerm");
const recTotalFee = document.getElementById("recTotalFee");
const recPaid = document.getElementById("recPaid");
const recBalance = document.getElementById("recBalance");
const recDate = document.getElementById("recDate");

let currentStudent = null;
let allReceiptRecords = [];

async function findStudentForUser(user) {
  const { data: student } = await supabase
    .from("students")
    .select("id, name, admission_no, classes(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (student) return student;

  const { data: altStudent } = await supabase
    .from("students")
    .select("id, name, admission_no, classes(name)")
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

    if (!student) throw new Error("Student record not found.");
    currentStudent = student;

    await loadReceipts(student.id);
  } catch (err) {
    console.error("Student receipts error:", err);
    alert(err?.message || "Failed to load receipts.");
  }
}

async function loadReceipts(studentId) {
  receiptsList.innerHTML = "";

  const { data: records, error } = await supabase
    .from("payment_records")
    .select("*, payment_invoices(total_amount, amount_paid, academic_session, term)")
    .eq("student_id", studentId)
    .in("status", ["successful", "success"])
    .order("payment_date", { ascending: false });

  if (error) {
    console.error("Error loading receipts:", error);
    receiptsList.innerHTML = `<div class="p-8 text-center text-rose-500">Failed to load receipts.</div>`;
    return;
  }

  allReceiptRecords = (records || []).filter(r => Boolean(r.receipt_number));

  if (!allReceiptRecords.length) {
    receiptsList.innerHTML = `<div class="p-8 text-center text-slate-500 bg-white rounded-xl border border-slate-200">No verified payment receipts found for your account.</div>`;
    return;
  }

  allReceiptRecords.forEach(rec => {
    const card = document.createElement("div");
    card.className = "bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4 hover:border-slate-300 transition-colors";

    const session = rec.payment_invoices?.academic_session || "2026/2027";
    const term = rec.payment_invoices?.term || "term1";
    const termDisplay = term === "term1" ? "1st Term" : term === "term2" ? "2nd Term" : term === "term3" ? "3rd Term" : term;

    card.innerHTML = `
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <span class="font-extrabold text-sm text-slate-900 font-mono">${rec.receipt_number}</span>
          <span class="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold rounded text-[10px] uppercase">Verified</span>
        </div>
        <p class="text-xs text-slate-500">${session} • ${termDisplay} • Ref: <span class="font-mono text-slate-700">${rec.payment_reference}</span></p>
        <p class="text-xs text-slate-400">Date: ${formatDate(rec.payment_date)}</p>
      </div>
      <div class="flex items-center gap-4">
        <div class="text-right">
          <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Amount Paid</span>
          <span class="text-lg font-extrabold text-emerald-700">${formatCurrency(rec.amount)}</span>
        </div>
        <button class="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg transition-colors shadow-sm" data-action="view" data-id="${rec.id}">
          View Receipt
        </button>
      </div>
    `;
    receiptsList.appendChild(card);
  });
}

function openReceiptModal(rec) {
  const invoice = rec.payment_invoices || {};
  const total = Number(invoice.total_amount || 0);
  const paidSoFar = Number(invoice.amount_paid || 0);
  const balance = Math.max(0, total - paidSoFar);

  const termDisplay = invoice.term === "term1" ? "First Term" : invoice.term === "term2" ? "Second Term" : invoice.term === "term3" ? "Third Term" : (invoice.term || "First Term");

  recNo.textContent = rec.receipt_number;
  recRef.textContent = rec.payment_reference;
  recStudentName.textContent = currentStudent.name;
  recAdmNo.textContent = currentStudent.admission_no;
  recClass.textContent = currentStudent.classes?.name || "Unassigned";
  recSessionTerm.textContent = `${invoice.academic_session || "2026/2027"} • ${termDisplay}`;

  recTotalFee.textContent = formatCurrency(total);
  recPaid.textContent = formatCurrency(rec.amount);
  recBalance.textContent = formatCurrency(balance);
  recDate.textContent = formatDate(rec.payment_date);

  toggleModal(true);
}

function toggleModal(show) {
  if (show) {
    receiptModal.classList.remove("hidden");
    requestAnimationFrame(() => receiptModal.classList.remove("opacity-0"));
  } else {
    receiptModal.classList.add("opacity-0");
    setTimeout(() => receiptModal.classList.add("hidden"), 150);
  }
}

receiptsList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='view']");
  if (!btn) return;

  const id = btn.dataset.id;
  const rec = allReceiptRecords.find(r => r.id === id);
  if (rec) openReceiptModal(rec);
});

btnCloseReceiptModal.addEventListener("click", () => toggleModal(false));
btnPrintReceipt.addEventListener("click", () => window.print());

init();
