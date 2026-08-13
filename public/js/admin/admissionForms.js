import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { formatCurrency } from "/js/shared/schoolFinance.js";
import { getAppSettings } from "/js/shared/appSettings.js";

const authLoader = document.getElementById("authLoader");
const formsTableBody = document.getElementById("formsTableBody");

const formModal = document.getElementById("formModal");
const admForm = document.getElementById("admForm");
const formModalTitle = document.getElementById("formModalTitle");

const btnOpenAddFormModal = document.getElementById("btnOpenAddFormModal");
const btnCloseFormModal = document.getElementById("btnCloseFormModal");
const btnCancelFormModal = document.getElementById("btnCancelFormModal");

const editFormId = document.getElementById("editFormId");
const modalFormName = document.getElementById("modalFormName");
const modalFormSession = document.getElementById("modalFormSession");
const modalFormAmount = document.getElementById("modalFormAmount");
const modalFormStatus = document.getElementById("modalFormStatus");
const modalFormDesc = document.getElementById("modalFormDesc");

let allForms = [];

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";

    await Promise.all([loadSchoolContext(), loadAdmissionForms()]);
  } catch (err) {
    console.error("Admission forms init error:", err);
    alert(err?.message || "Failed to load admission forms.");
  }
}

async function loadSchoolContext() {
  const settings = await getAppSettings();
  const currentSession = settings?.current_session || "2026/2027";
  const sessions = ["2024/2025", "2025/2026", "2026/2027", "2027/2028"];
  if (!sessions.includes(currentSession)) sessions.push(currentSession);

  modalFormSession.innerHTML = sessions.map(s => `<option value="${s}" ${s === currentSession ? "selected" : ""}>${s}</option>`).join("");
}

async function loadAdmissionForms() {
  formsTableBody.innerHTML = "";

  const { data, error } = await supabase.from("admission_forms").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error("Error loading admission forms:", error);
    formsTableBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-rose-500">Failed to load admission forms.</td></tr>`;
    return;
  }

  allForms = data || [];

  if (!allForms.length) {
    formsTableBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-500">No admission form packages created yet. Click "+ Create Admission Form" to create one.</td></tr>`;
    return;
  }

  allForms.forEach(f => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 transition-colors";

    const isAct = f.status === "active";
    const statusBadge = isAct
      ? `<span class="px-2.5 py-1 bg-emerald-50 text-emerald-700 font-semibold rounded text-[11px]">Active</span>`
      : `<span class="px-2.5 py-1 bg-slate-100 text-slate-600 font-semibold rounded text-[11px]">Inactive</span>`;

    tr.innerHTML = `
      <td class="px-5 py-3.5">
        <span class="font-bold text-slate-900 block">${f.name}</span>
        <span class="text-[11px] text-slate-400">${f.description || "No description"}</span>
      </td>
      <td class="px-5 py-3.5 font-medium text-slate-700">${f.academic_session}</td>
      <td class="px-5 py-3.5 text-right font-extrabold text-slate-900">${formatCurrency(f.amount)}</td>
      <td class="px-5 py-3.5 text-center">${statusBadge}</td>
      <td class="px-5 py-3.5 text-right space-x-2">
        <button class="text-blue-600 hover:text-blue-800 font-semibold text-xs" data-action="edit" data-id="${f.id}">Edit</button>
        <button class="text-slate-500 hover:text-slate-700 text-xs" data-action="toggle" data-id="${f.id}">${isAct ? "Deactivate" : "Activate"}</button>
      </td>
    `;
    formsTableBody.appendChild(tr);
  });
}

function openAddModal() {
  admForm.reset();
  editFormId.value = "";
  formModalTitle.textContent = "Create Admission Form";
  toggleModal(true);
}

function openEditModal(f) {
  editFormId.value = f.id;
  modalFormName.value = f.name;
  modalFormSession.value = f.academic_session;
  modalFormAmount.value = f.amount;
  modalFormStatus.value = f.status || "active";
  modalFormDesc.value = f.description || "";

  formModalTitle.textContent = "Edit Admission Form";
  toggleModal(true);
}

function toggleModal(show) {
  if (show) {
    formModal.classList.remove("hidden");
    requestAnimationFrame(() => formModal.classList.remove("opacity-0"));
  } else {
    formModal.classList.add("opacity-0");
    setTimeout(() => formModal.classList.add("hidden"), 150);
  }
}

formsTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const f = allForms.find(item => item.id === id);
  if (!f) return;

  if (action === "edit") {
    openEditModal(f);
  } else if (action === "toggle") {
    const nextStatus = f.status === "active" ? "inactive" : "active";
    const { error } = await supabase.from("admission_forms").update({ status: nextStatus }).eq("id", id);
    if (error) {
      alert("Failed to toggle status: " + error.message);
    } else {
      await loadAdmissionForms();
    }
  }
});

btnOpenAddFormModal.addEventListener("click", openAddModal);
btnCloseFormModal.addEventListener("click", () => toggleModal(false));
btnCancelFormModal.addEventListener("click", () => toggleModal(false));

admForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = editFormId.value;
  const payload = {
    name: modalFormName.value.trim(),
    academic_session: modalFormSession.value,
    amount: Number(modalFormAmount.value || 0),
    status: modalFormStatus.value,
    description: modalFormDesc.value.trim() || null
  };

  try {
    if (id) {
      const { error } = await supabase.from("admission_forms").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("admission_forms").insert([payload]);
      if (error) throw error;
    }

    toggleModal(false);
    await loadAdmissionForms();
  } catch (err) {
    alert("Failed to save admission form: " + err.message);
  }
});

init();
