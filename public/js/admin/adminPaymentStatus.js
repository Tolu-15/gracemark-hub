import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { formatCurrency, getCurrentAcademicSessionAndTerm, calculatePaymentStatus } from "/js/shared/schoolFinance.js";

const authLoader = document.getElementById("authLoader");
const statusTableBody = document.getElementById("statusTableBody");

const statTotalStudents = document.getElementById("statTotalStudents");
const statFullyPaidCount = document.getElementById("statFullyPaidCount");
const statFullyPaidPct = document.getElementById("statFullyPaidPct");
const statPartialCount = document.getElementById("statPartialCount");
const statPartialPct = document.getElementById("statPartialPct");
const statUnpaidCount = document.getElementById("statUnpaidCount");
const statUnpaidPct = document.getElementById("statUnpaidPct");

const filterClass = document.getElementById("filterClass");
const filterPaymentStatus = document.getElementById("filterPaymentStatus");
const searchInput = document.getElementById("searchInput");

let allStudentsData = [];
let allClasses = [];

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";

    await Promise.all([loadClasses(), loadStudentPaymentStatuses()]);
  } catch (err) {
    console.error("Payment status init error:", err);
    alert(err?.message || "Failed to load payment status.");
  }
}

async function loadClasses() {
  const { data } = await supabase.from("classes").select("id, name").order("name");
  allClasses = data || [];
  filterClass.innerHTML = `<option value="">All Classes</option>` +
    allClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

async function loadStudentPaymentStatuses() {
  statusTableBody.innerHTML = "";

  const { session, termCode, termName } = await getCurrentAcademicSessionAndTerm();

  // 1. Fetch all students
  const { data: students, error: sErr } = await supabase
    .from("students")
    .select("id, name, admission_no, class_id, portal_access_status, classes(id, name)")
    .order("name");

  if (sErr) throw sErr;

  // 2. Fetch fee structures for session
  const { data: fees } = await supabase
    .from("fee_structures")
    .select("*")
    .eq("academic_session", session)
    .eq("status", "active");

  const feeMap = new Map();
  (fees || []).forEach(f => {
    const tot = Number(f.tuition_amount || 0) + Number(f.registration_fee || 0) + Number(f.exams_fee || 0) + Number(f.facilities_fee || 0);
    feeMap.set(f.class_id, tot);
  });

  // 3. Fetch ALL invoices (no session filter — some may be created without session field set)
  const { data: invoices } = await supabase
    .from("payment_invoices")
    .select("id, student_id, total_amount, amount_paid, status, academic_session, term");

  const invoiceMap = new Map();
  (invoices || []).forEach(inv => {
    // Prefer session-matched invoice; fall back to any invoice for student
    const existing = invoiceMap.get(inv.student_id);
    const sessionMatch = inv.academic_session === session &&
      (inv.term === termCode || inv.term === termName);
    if (!existing || sessionMatch) {
      invoiceMap.set(inv.student_id, inv);
    }
  });

  // 4. Fetch all successful payment_records — the authoritative source
  const { data: allRecords } = await supabase
    .from("payment_records")
    .select("invoice_id, amount, status");

  const recordsByInvoice = new Map();
  (allRecords || []).forEach(r => {
    if (!["successful", "success"].includes(r.status)) return;
    const sum = (recordsByInvoice.get(r.invoice_id) || 0) + Number(r.amount || 0);
    recordsByInvoice.set(r.invoice_id, sum);
  });

  allStudentsData = (students || []).map(stu => {
    const inv = invoiceMap.get(stu.id);
    const expected = inv ? Number(inv.total_amount) : (feeMap.get(stu.class_id) || 0);
    // Use verified payment_records sum — not invoice.amount_paid which may lag
    const paid = inv ? (recordsByInvoice.get(inv.id) || Number(inv.amount_paid) || 0) : 0;
    const balance = Math.max(0, expected - paid);
    const status = calculatePaymentStatus(expected, paid);

    return {
      ...stu,
      expected,
      paid,
      balance,
      status
    };
  });

  renderStatusData();
}

function renderStatusData() {
  statusTableBody.innerHTML = "";

  const q = String(searchInput.value || "").toLowerCase().trim();
  const fClass = filterClass.value;
  const fStatus = filterPaymentStatus.value;

  const filtered = allStudentsData.filter(stu => {
    if (fClass && stu.class_id !== fClass) return false;
    if (fStatus && stu.status !== fStatus) return false;
    if (q) {
      const matchName = String(stu.name || "").toLowerCase().includes(q);
      const matchAdm = String(stu.admission_no || "").toLowerCase().includes(q);
      if (!matchName && !matchAdm) return false;
    }
    return true;
  });

  // Calculate Statistics
  const totalCount = filtered.length;
  const fullyPaidCount = filtered.filter(s => s.status === "FULLY PAID").length;
  const partialCount = filtered.filter(s => s.status === "PARTIALLY PAID").length;
  const unpaidCount = filtered.filter(s => s.status === "UNPAID").length;

  statTotalStudents.textContent = String(totalCount);
  statFullyPaidCount.textContent = String(fullyPaidCount);
  statPartialCount.textContent = String(partialCount);
  statUnpaidCount.textContent = String(unpaidCount);

  statFullyPaidPct.textContent = totalCount ? `${((fullyPaidCount / totalCount) * 100).toFixed(1)}%` : "0.0%";
  statPartialPct.textContent = totalCount ? `${((partialCount / totalCount) * 100).toFixed(1)}%` : "0.0%";
  statUnpaidPct.textContent = totalCount ? `${((unpaidCount / totalCount) * 100).toFixed(1)}%` : "0.0%";

  if (!filtered.length) {
    statusTableBody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-500">No student payment records found matching criteria.</td></tr>`;
    return;
  }

  filtered.forEach(stu => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 transition-colors";

    let badgeClass = "bg-rose-50 text-rose-700 font-semibold";
    if (stu.status === "FULLY PAID") badgeClass = "bg-emerald-50 text-emerald-700 font-semibold";
    else if (stu.status === "PARTIALLY PAID") badgeClass = "bg-amber-50 text-amber-700 font-semibold";

    const isLocked = stu.portal_access_status === "LOCKED";
    const portalBadge = isLocked
      ? `<span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-semibold rounded text-[11px]">LOCKED</span>`
      : `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-semibold rounded text-[11px]">ACTIVE</span>`;

    tr.innerHTML = `
      <td class="px-5 py-3.5">
        <span class="font-bold text-slate-900 block">${stu.name}</span>
        <span class="text-[11px] text-slate-400 font-mono">${stu.admission_no}</span>
      </td>
      <td class="px-5 py-3.5 font-medium text-slate-700">${stu.classes?.name || "Unassigned"}</td>
      <td class="px-5 py-3.5 text-right text-slate-700 font-medium">${formatCurrency(stu.expected)}</td>
      <td class="px-5 py-3.5 text-right text-emerald-700 font-semibold">${formatCurrency(stu.paid)}</td>
      <td class="px-5 py-3.5 text-right font-extrabold text-slate-900">${formatCurrency(stu.balance)}</td>
      <td class="px-5 py-3.5 text-center"><span class="px-2.5 py-1 rounded text-[11px] ${badgeClass}">${stu.status}</span></td>
      <td class="px-5 py-3.5 text-center">${portalBadge}</td>
    `;
    statusTableBody.appendChild(tr);
  });
}

[searchInput, filterClass, filterPaymentStatus].forEach(el => {
  el?.addEventListener("change", renderStatusData);
  el?.addEventListener("input", renderStatusData);
});

init();
