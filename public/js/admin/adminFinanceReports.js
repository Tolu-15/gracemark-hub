import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { formatCurrency, getCurrentAcademicSessionAndTerm, calculatePaymentStatus } from "/js/shared/schoolFinance.js";
import { getAppSettings } from "/js/shared/appSettings.js";

const authLoader = document.getElementById("authLoader");
const reportsTableBody = document.getElementById("reportsTableBody");

const repTotalExpected = document.getElementById("repTotalExpected");
const repTotalCollected = document.getElementById("repTotalCollected");
const repTotalOutstanding = document.getElementById("repTotalOutstanding");

const filterSession = document.getElementById("filterSession");
const filterTerm = document.getElementById("filterTerm");
const filterClass = document.getElementById("filterClass");
const filterReportCategory = document.getElementById("filterReportCategory");

let allReportItems = [];

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";

    await Promise.all([loadSchoolContext(), loadClasses(), loadReportData()]);
  } catch (err) {
    console.error("Admin finance reports init error:", err);
    alert(err?.message || "Failed to load financial reports.");
  }
}

async function loadSchoolContext() {
  const settings = await getAppSettings();
  const currentSession = settings?.current_session || "2026/2027";

  const sessions = ["2024/2025", "2025/2026", "2026/2027", "2027/2028"];
  if (!sessions.includes(currentSession)) sessions.push(currentSession);

  filterSession.innerHTML = `<option value="">All Sessions</option>` +
    sessions.map(s => `<option value="${s}" ${s === currentSession ? "selected" : ""}>${s}</option>`).join("");
}

async function loadClasses() {
  const { data } = await supabase.from("classes").select("id, name").order("name");
  filterClass.innerHTML = `<option value="">All Classes</option>` +
    (data || []).map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

async function loadReportData() {
  reportsTableBody.innerHTML = "";

  const { session, termCode, termName } = await getCurrentAcademicSessionAndTerm();
  const selectedSession = filterSession.value || session;
  const selectedTerm = filterTerm.value || termCode;
  const selectedTermName = selectedTerm === "term1" ? "First Term" : selectedTerm === "term2" ? "Second Term" : selectedTerm === "term3" ? "Third Term" : selectedTerm;

  const { data: students } = await supabase
    .from("students")
    .select("id, name, admission_no, class_id, classes(name)")
    .order("name");

  const { data: fees } = await supabase
    .from("fee_structures")
    .select("*")
    .eq("status", "active");

  const feeMap = new Map();
  (fees || []).forEach(f => {
    const tot = Number(f.tuition_amount || 0) + Number(f.registration_fee || 0) + Number(f.exams_fee || 0) + Number(f.facilities_fee || 0);
    feeMap.set(`${f.class_id}_${f.academic_session}`, tot);
    feeMap.set(`${f.class_id}_${f.academic_session}_${f.term}`, tot);
  });

  // Fetch ALL invoices — no session filter; pick best per student
  const { data: invoices } = await supabase
    .from("payment_invoices")
    .select("id, student_id, academic_session, term, total_amount, amount_paid, status");

  const invoiceMap = new Map();
  (invoices || []).forEach(inv => {
    const existing = invoiceMap.get(inv.student_id);
    const selectedMatch = inv.academic_session === selectedSession &&
      (inv.term === selectedTerm || inv.term === selectedTermName);
    const currentMatch = inv.academic_session === session &&
      (inv.term === termCode || inv.term === termName);
    if (!existing || selectedMatch || (!filterSession.value && currentMatch)) invoiceMap.set(inv.student_id, inv);
  });

  // Fetch verified payment records — the authoritative source of paid amounts
  const { data: allRecords } = await supabase
    .from("payment_records")
    .select("invoice_id, amount, status");

  const paidByInvoice = new Map();
  (allRecords || []).forEach(r => {
    if (!["successful", "success"].includes(r.status)) return;
    paidByInvoice.set(r.invoice_id, (paidByInvoice.get(r.invoice_id) || 0) + Number(r.amount || 0));
  });

  allReportItems = (students || []).map(stu => {
    const inv = invoiceMap.get(stu.id);
    const expected = inv ? Number(inv.total_amount) :
      (feeMap.get(`${stu.class_id}_${selectedSession}_${selectedTerm}`) || feeMap.get(`${stu.class_id}_${selectedSession}`) || 0);
    // Use actual payment_records sum as authoritative paid amount
    const paid = inv ? (paidByInvoice.get(inv.id) ?? Number(inv.amount_paid) ?? 0) : 0;
    const balance = Math.max(0, expected - paid);
    const status = calculatePaymentStatus(expected, paid);

    return {
      ...stu,
      session: selectedSession,
      expected,
      paid,
      balance,
      status
    };
  });

  renderReports();
}

function renderReports() {
  reportsTableBody.innerHTML = "";

  const fClass = filterClass.value;
  const fCat = filterReportCategory.value;

  const filtered = allReportItems.filter(item => {
    if (fClass && item.class_id !== fClass) return false;
    if (fCat && fCat !== "ALL" && item.status !== fCat) return false;
    return true;
  });

  const totalExp = filtered.reduce((s, i) => s + i.expected, 0);
  const totalColl = filtered.reduce((s, i) => s + i.paid, 0);
  const totalOut = filtered.reduce((s, i) => s + i.balance, 0);

  repTotalExpected.textContent = formatCurrency(totalExp);
  repTotalCollected.textContent = formatCurrency(totalColl);
  repTotalOutstanding.textContent = formatCurrency(totalOut);

  if (!filtered.length) {
    reportsTableBody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-500">No student financial records found matching report criteria.</td></tr>`;
    return;
  }

  filtered.forEach(item => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 transition-colors";

    let badgeClass = "bg-rose-50 text-rose-700 font-semibold";
    if (item.status === "FULLY PAID") badgeClass = "bg-emerald-50 text-emerald-700 font-semibold";
    else if (item.status === "PARTIALLY PAID") badgeClass = "bg-amber-50 text-amber-700 font-semibold";

    tr.innerHTML = `
      <td class="px-5 py-3.5 font-bold text-slate-900">${item.name}</td>
      <td class="px-5 py-3.5 font-mono text-slate-600">${item.admission_no}</td>
      <td class="px-5 py-3.5 font-medium text-slate-700">${item.classes?.name || "Unassigned"}</td>
      <td class="px-5 py-3.5 text-right text-slate-700 font-medium">${formatCurrency(item.expected)}</td>
      <td class="px-5 py-3.5 text-right font-semibold text-emerald-700">${formatCurrency(item.paid)}</td>
      <td class="px-5 py-3.5 text-right font-extrabold text-slate-900">${formatCurrency(item.balance)}</td>
      <td class="px-5 py-3.5 text-center"><span class="px-2.5 py-1 rounded text-[11px] ${badgeClass}">${item.status}</span></td>
    `;
    reportsTableBody.appendChild(tr);
  });
}

[filterSession, filterTerm, filterClass, filterReportCategory].forEach(el => {
  el?.addEventListener("change", () => {
    loadReportData();
  });
});

init();
