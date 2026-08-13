import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { formatCurrency, formatDate } from "/js/shared/schoolFinance.js";
import { getAppSettings } from "/js/shared/appSettings.js";

const authLoader = document.getElementById("authLoader");
const paymentsTableBody = document.getElementById("paymentsTableBody");

const filterSession = document.getElementById("filterSession");
const filterTerm = document.getElementById("filterTerm");
const filterClass = document.getElementById("filterClass");
const searchInput = document.getElementById("searchInput");

let allPayments = [];

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";

    await Promise.all([loadSchoolContext(), loadClasses(), loadPayments()]);
  } catch (err) {
    console.error("Admin payments init error:", err);
    alert(err?.message || "Failed to load payments.");
  }
}

async function loadSchoolContext() {
  const settings = await getAppSettings();
  const currentSession = settings?.current_session || "2026/2027";

  const sessions = ["2024/2025", "2025/2026", "2026/2027", "2027/2028"];
  if (!sessions.includes(currentSession)) sessions.push(currentSession);

  filterSession.innerHTML = `<option value="">All Sessions</option>` +
    sessions.map(s => `<option value="${s}">${s}</option>`).join("");
}

async function loadClasses() {
  const { data } = await supabase.from("classes").select("id, name").order("name");
  filterClass.innerHTML = `<option value="">All Classes</option>` +
    (data || []).map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

async function loadPayments() {
  paymentsTableBody.innerHTML = "";

  const { data, error } = await supabase
    .from("payment_records")
    .select("*, students(id, name, admission_no, class_id, classes(name)), payment_invoices(academic_session, term, class_id)")
    .order("payment_date", { ascending: false });

  if (error) {
    console.error("Error loading payment records:", error);
    paymentsTableBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-rose-500">Failed to load payment records.</td></tr>`;
    return;
  }

  allPayments = data || [];
  renderPayments();
}

function renderPayments() {
  paymentsTableBody.innerHTML = "";

  const q = String(searchInput.value || "").toLowerCase().trim();
  const fSess = filterSession.value;
  const fTerm = filterTerm.value;
  const fClass = filterClass.value;

  const filtered = allPayments.filter(p => {
    const pSession = p.payment_invoices?.academic_session;
    const pTerm = p.payment_invoices?.term;
    const pClassId = p.students?.class_id || p.payment_invoices?.class_id;

    if (fSess && pSession !== fSess) return false;
    if (fTerm && pTerm !== fTerm) return false;
    if (fClass && pClassId !== fClass) return false;

    if (q) {
      const matchName = String(p.students?.name || "").toLowerCase().includes(q);
      const matchAdm = String(p.students?.admission_no || "").toLowerCase().includes(q);
      const matchRef = String(p.payment_reference || "").toLowerCase().includes(q);
      const matchRec = String(p.receipt_number || "").toLowerCase().includes(q);
      if (!matchName && !matchAdm && !matchRef && !matchRec) return false;
    }
    return true;
  });

  if (!filtered.length) {
    paymentsTableBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-500">No payment transactions found matching criteria.</td></tr>`;
    return;
  }

  filtered.forEach(p => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 transition-colors";

    const sName = p.students?.name || "Unknown Student";
    const sAdm = p.students?.admission_no || "—";
    const cName = p.students?.classes?.name || "Unassigned";

    const session = p.payment_invoices?.academic_session || "2026/2027";
    const term = p.payment_invoices?.term || "term1";
    const termDisplay = term === "term1" ? "1st Term" : term === "term2" ? "2nd Term" : term === "term3" ? "3rd Term" : term;

    const isSuccess = p.status === "successful" || p.status === "success";
    const badgeClass = isSuccess ? "bg-emerald-50 text-emerald-700 font-semibold" : "bg-amber-50 text-amber-700 font-semibold";

    tr.innerHTML = `
      <td class="px-5 py-3.5">
        <span class="font-bold text-slate-900 block">${sName}</span>
        <span class="text-[11px] text-slate-400 font-mono">${sAdm}</span>
      </td>
      <td class="px-5 py-3.5 font-medium text-slate-700">${cName}</td>
      <td class="px-5 py-3.5 text-slate-600">${session} • ${termDisplay}</td>
      <td class="px-5 py-3.5 font-mono text-slate-900 font-semibold">${p.payment_reference}</td>
      <td class="px-5 py-3.5 font-mono text-slate-700">${p.receipt_number || "—"}</td>
      <td class="px-5 py-3.5 text-right font-extrabold text-slate-900">${formatCurrency(p.amount)}</td>
      <td class="px-5 py-3.5 text-center"><span class="px-2.5 py-1 rounded text-[11px] ${badgeClass}">${isSuccess ? "Successful" : p.status}</span></td>
      <td class="px-5 py-3.5 text-right text-slate-500">${formatDate(p.payment_date)}</td>
    `;
    paymentsTableBody.appendChild(tr);
  });
}

[searchInput, filterSession, filterTerm, filterClass].forEach(el => {
  el?.addEventListener("change", renderPayments);
  el?.addEventListener("input", renderPayments);
});

init();
