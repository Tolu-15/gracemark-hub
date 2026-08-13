import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { formatCurrency } from "/js/shared/schoolFinance.js";
import { getAppSettings } from "/js/shared/appSettings.js";

const authLoader = document.getElementById("authLoader");
const feesTableBody = document.getElementById("feesTableBody");

const filterSession = document.getElementById("filterSession");
const filterTerm = document.getElementById("filterTerm");
const filterClass = document.getElementById("filterClass");
const filterStatus = document.getElementById("filterStatus");
const searchInput = document.getElementById("searchInput");

const feeModal = document.getElementById("feeModal");
const feeForm = document.getElementById("feeForm");
const feeModalTitle = document.getElementById("feeModalTitle");

const btnOpenAddFeeModal = document.getElementById("btnOpenAddFeeModal");
const btnCloseFeeModal = document.getElementById("btnCloseFeeModal");
const btnCancelFeeModal = document.getElementById("btnCancelFeeModal");

const editFeeId = document.getElementById("editFeeId");
const modalSession = document.getElementById("modalSession");
const modalTerm = document.getElementById("modalTerm");
const modalClass = document.getElementById("modalClass");
const modalFeeType = document.getElementById("modalFeeType");
const modalTuition = document.getElementById("modalTuition");
const modalRegistration = document.getElementById("modalRegistration");
const modalExams = document.getElementById("modalExams");
const modalFacilities = document.getElementById("modalFacilities");
const modalDueDate = document.getElementById("modalDueDate");
const modalStatus = document.getElementById("modalStatus");
const modalDesc = document.getElementById("modalDesc");

let allFees = [];
let allClasses = [];
let defaultSchoolId = null;

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";

    await Promise.all([loadSchoolContext(), loadClasses(), loadFeeStructures()]);
  } catch (err) {
    console.error("Finance fees init error:", err);
    alert(err?.message || "Failed to initialize fee management.");
  }
}

async function loadSchoolContext() {
  const { data: school } = await supabase.from("schools").select("id").limit(1).single();
  if (school?.id) defaultSchoolId = school.id;

  const settings = await getAppSettings();
  const currentSession = settings?.current_session || "2026/2027";

  const sessions = ["2024/2025", "2025/2026", "2026/2027", "2027/2028"];
  if (!sessions.includes(currentSession)) sessions.push(currentSession);

  filterSession.innerHTML = `<option value="">All Sessions</option>` +
    sessions.map(s => `<option value="${s}" ${s === currentSession ? "selected" : ""}>${s}</option>`).join("");

  modalSession.innerHTML = sessions.map(s => `<option value="${s}" ${s === currentSession ? "selected" : ""}>${s}</option>`).join("");
}

async function loadClasses() {
  const { data, error } = await supabase.from("classes").select("id, name").order("name");
  if (error) throw error;

  allClasses = data || [];

  const opts = allClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  filterClass.innerHTML = `<option value="">All Classes</option>` + opts;
  modalClass.innerHTML = opts;
}

async function loadFeeStructures() {
  const { data, error } = await supabase
    .from("fee_structures")
    .select("*, classes(id, name)")
    .order("created_at", { ascending: false });

  if (error) throw error;

  allFees = data || [];
  renderFees();
}

function renderFees() {
  feesTableBody.innerHTML = "";

  const q = String(searchInput.value || "").toLowerCase().trim();
  const fSess = filterSession.value;
  const fTerm = filterTerm.value;
  const fClass = filterClass.value;
  const fStat = filterStatus.value;

  const filtered = allFees.filter(f => {
    if (fSess && f.academic_session !== fSess) return false;
    if (fTerm && f.term !== fTerm) return false;
    if (fClass && f.class_id !== fClass) return false;
    if (fStat && f.status !== fStat) return false;
    if (q) {
      const matchType = String(f.fee_type || "").toLowerCase().includes(q);
      const matchDesc = String(f.description || "").toLowerCase().includes(q);
      const matchClass = String(f.classes?.name || "").toLowerCase().includes(q);
      if (!matchType && !matchDesc && !matchClass) return false;
    }
    return true;
  });

  if (!filtered.length) {
    feesTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="p-8 text-center text-slate-500">No fee structures found matching criteria.</td>
      </tr>
    `;
    return;
  }

  filtered.forEach(fee => {
    const totalAmount = Number(fee.tuition_amount || 0) +
      Number(fee.registration_fee || 0) +
      Number(fee.exams_fee || 0) +
      Number(fee.facilities_fee || 0);

    const termDisplay = fee.term === "term1" ? "1st Term" : fee.term === "term2" ? "2nd Term" : fee.term === "term3" ? "3rd Term" : fee.term;
    const statusBadge = fee.status === "active"
      ? `<span class="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold rounded text-[11px]">Active</span>`
      : `<span class="px-2 py-0.5 bg-slate-100 text-slate-600 font-semibold rounded text-[11px]">Inactive</span>`;

    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 transition-colors";
    tr.innerHTML = `
      <td class="px-5 py-3.5 font-bold text-slate-900">${fee.classes?.name || "Unassigned"}</td>
      <td class="px-5 py-3.5 text-slate-600">${fee.academic_session} • <span class="font-medium">${termDisplay}</span></td>
      <td class="px-5 py-3.5 font-semibold text-slate-800">${fee.fee_type || "School Fees"}</td>
      <td class="px-5 py-3.5 text-right text-slate-700">${formatCurrency(fee.tuition_amount)}</td>
      <td class="px-5 py-3.5 text-right font-bold text-slate-900">${formatCurrency(totalAmount)}</td>
      <td class="px-5 py-3.5 text-center">${statusBadge}</td>
      <td class="px-5 py-3.5 text-right space-x-2">
        <button class="text-blue-600 hover:text-blue-800 font-semibold text-xs" data-action="edit" data-id="${fee.id}">Edit</button>
        <button class="text-slate-500 hover:text-slate-700 text-xs" data-action="toggle" data-id="${fee.id}">${fee.status === "active" ? "Deactivate" : "Activate"}</button>
      </td>
    `;
    feesTableBody.appendChild(tr);
  });
}

function openAddModal() {
  feeForm.reset();
  editFeeId.value = "";
  feeModalTitle.textContent = "Add Fee Structure";
  toggleModal(true);
}

function openEditModal(fee) {
  editFeeId.value = fee.id;
  modalSession.value = fee.academic_session;
  modalTerm.value = fee.term;
  modalClass.value = fee.class_id;
  modalFeeType.value = fee.fee_type || "School Fees";
  modalTuition.value = fee.tuition_amount;
  modalRegistration.value = fee.registration_fee || 0;
  modalExams.value = fee.exams_fee || 0;
  modalFacilities.value = fee.facilities_fee || 0;
  modalDueDate.value = fee.due_date || "";
  modalStatus.value = fee.status || "active";
  modalDesc.value = fee.description || "";

  feeModalTitle.textContent = "Edit Fee Structure";
  toggleModal(true);
}

function toggleModal(show) {
  if (show) {
    feeModal.classList.remove("hidden");
    requestAnimationFrame(() => feeModal.classList.remove("opacity-0"));
  } else {
    feeModal.classList.add("opacity-0");
    setTimeout(() => feeModal.classList.add("hidden"), 150);
  }
}

feesTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const fee = allFees.find(f => f.id === id);
  if (!fee) return;

  if (action === "edit") {
    openEditModal(fee);
  } else if (action === "toggle") {
    const nextStatus = fee.status === "active" ? "inactive" : "active";
    const { error } = await supabase.from("fee_structures").update({ status: nextStatus }).eq("id", id);
    if (error) {
      alert("Failed to update status: " + error.message);
    } else {
      await loadFeeStructures();
    }
  }
});

btnOpenAddFeeModal.addEventListener("click", openAddModal);
btnCloseFeeModal.addEventListener("click", () => toggleModal(false));
btnCancelFeeModal.addEventListener("click", () => toggleModal(false));

feeForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = editFeeId.value;
  const payload = {
    school_id: defaultSchoolId,
    academic_session: modalSession.value,
    term: modalTerm.value,
    class_id: modalClass.value,
    fee_type: modalFeeType.value.trim() || "School Fees",
    tuition_amount: Number(modalTuition.value || 0),
    registration_fee: Number(modalRegistration.value || 0),
    exams_fee: Number(modalExams.value || 0),
    facilities_fee: Number(modalFacilities.value || 0),
    due_date: modalDueDate.value || null,
    status: modalStatus.value,
    description: modalDesc.value.trim() || null
  };

  try {
    if (id) {
      const { error } = await supabase.from("fee_structures").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("fee_structures").insert([payload]);
      if (error) throw error;
    }

    toggleModal(false);
    await loadFeeStructures();
  } catch (err) {
    alert("Failed to save fee structure: " + err.message);
  }
});

[searchInput, filterSession, filterTerm, filterClass, filterStatus].forEach(el => {
  el?.addEventListener("change", renderFees);
  el?.addEventListener("input", renderFees);
});

init();
