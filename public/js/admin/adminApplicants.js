import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { formatDate } from "/js/shared/schoolFinance.js";

const authLoader = document.getElementById("authLoader");
const applicantsTableBody = document.getElementById("applicantsTableBody");

const filterClass = document.getElementById("filterClass");
const filterAppStatus = document.getElementById("filterAppStatus");
const searchInput = document.getElementById("searchInput");

const applicantModal = document.getElementById("applicantModal");
const btnCloseApplicantModal = document.getElementById("btnCloseApplicantModal");

const appModalName = document.getElementById("appModalName");
const appModalRef = document.getElementById("appModalRef");
const appGender = document.getElementById("appGender");
const appDOB = document.getElementById("appDOB");
const appState = document.getElementById("appState");
const appAddress = document.getElementById("appAddress");
const appPrevSchool = document.getElementById("appPrevSchool");
const appPrevClass = document.getElementById("appPrevClass");
const appParentName = document.getElementById("appParentName");
const appParentPhone = document.getElementById("appParentPhone");
const appParentEmail = document.getElementById("appParentEmail");
const appParentOccupation = document.getElementById("appParentOccupation");
const appBoarding = document.getElementById("appBoarding");
const appMedical = document.getElementById("appMedical");

const modalUpdateStatus = document.getElementById("modalUpdateStatus");
const btnSaveAppStatus = document.getElementById("btnSaveAppStatus");

let allApplicants = [];
let selectedApplicantId = null;

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";

    await Promise.all([loadClasses(), loadApplicants()]);
  } catch (err) {
    console.error("Admin applicants init error:", err);
    alert(err?.message || "Failed to load applicants.");
  }
}

async function loadClasses() {
  const { data } = await supabase.from("classes").select("id, name").order("name");
  filterClass.innerHTML = `<option value="">All Desired Classes</option>` +
    (data || []).map(c => `<option value="${c.name}">${c.name}</option>`).join("");
}

async function loadApplicants() {
  applicantsTableBody.innerHTML = "";

  const { data, error } = await supabase
    .from("admissions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading applicants:", error);
    applicantsTableBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-rose-500">Failed to load applicants.</td></tr>`;
    return;
  }

  allApplicants = data || [];
  renderApplicants();
}

function renderApplicants() {
  applicantsTableBody.innerHTML = "";

  const q = String(searchInput.value || "").toLowerCase().trim();
  const fClass = filterClass.value;
  const fStatus = filterAppStatus.value;

  const filtered = allApplicants.filter(a => {
    if (fClass && a.desired_class !== fClass) return false;
    if (fStatus && a.application_status !== fStatus) return false;
    if (q) {
      const matchName = `${a.surname || ''} ${a.first_names || ''}`.toLowerCase().includes(q);
      const matchRef = String(a.admission_number || '').toLowerCase().includes(q);
      const matchEmail = String(a.parent_guardian_email || '').toLowerCase().includes(q);
      if (!matchName && !matchRef && !matchEmail) return false;
    }
    return true;
  });

  if (!filtered.length) {
    applicantsTableBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-500">No applicants found matching criteria.</td></tr>`;
    return;
  }

  filtered.forEach(a => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 transition-colors";

    const name = `${a.surname} ${a.first_names}`;
    let badgeClass = "bg-slate-100 text-slate-700";
    if (a.application_status === "approved") badgeClass = "bg-emerald-50 text-emerald-700 font-semibold";
    else if (a.application_status === "submitted") badgeClass = "bg-blue-50 text-blue-700 font-semibold";
    else if (a.application_status === "under_review") badgeClass = "bg-amber-50 text-amber-700 font-semibold";
    else if (a.application_status === "rejected") badgeClass = "bg-rose-50 text-rose-700 font-semibold";

    tr.innerHTML = `
      <td class="px-5 py-3.5">
        <span class="font-bold text-slate-900 block">${name}</span>
        <span class="text-[11px] text-slate-400">Applied: ${formatDate(a.created_at)}</span>
      </td>
      <td class="px-5 py-3.5 font-mono text-slate-900 font-semibold">${a.admission_number || "—"}</td>
      <td class="px-5 py-3.5 font-medium text-slate-700">${a.desired_class}</td>
      <td class="px-5 py-3.5 text-slate-600">
        <span class="block">${a.parent_guardian_email || '—'}</span>
        <span class="text-[11px] text-slate-400 font-mono">${a.parent_guardian_phone || '—'}</span>
      </td>
      <td class="px-5 py-3.5 text-center"><span class="px-2.5 py-1 rounded text-[11px] uppercase ${badgeClass}">${a.application_status}</span></td>
      <td class="px-5 py-3.5 text-right">
        <button class="px-3 py-1.5 bg-slate-900 text-white font-semibold text-xs rounded-lg hover:bg-slate-800 transition-colors" data-action="view" data-id="${a.id}">View Profile</button>
      </td>
    `;
    applicantsTableBody.appendChild(tr);
  });
}

function openApplicantModal(a) {
  selectedApplicantId = a.id;
  appModalName.textContent = `${a.surname} ${a.first_names}`;
  appModalRef.textContent = a.admission_number || "—";
  appGender.textContent = a.gender === "M" ? "Male" : a.gender === "F" ? "Female" : "—";
  appDOB.textContent = formatDate(a.date_of_birth);
  appState.textContent = a.state_of_origin || "—";
  appAddress.textContent = a.home_address || "—";

  appPrevSchool.textContent = a.previous_school_name || "—";
  appPrevClass.textContent = a.previous_class || "—";

  appParentName.textContent = a.parent_guardian_name || "—";
  appParentPhone.textContent = a.parent_guardian_phone || "—";
  appParentEmail.textContent = a.parent_guardian_email || "—";
  appParentOccupation.textContent = a.parent_guardian_occupation || "—";

  appBoarding.textContent = a.is_boarding ? `Boarding (${a.boarding_type || "Full"})` : "Day Student";
  appMedical.textContent = a.medical_conditions || "None reported";

  modalUpdateStatus.value = a.application_status || "submitted";

  toggleModal(true);
}

function toggleModal(show) {
  if (show) {
    applicantModal.classList.remove("hidden");
    requestAnimationFrame(() => applicantModal.classList.remove("opacity-0"));
  } else {
    applicantModal.classList.add("opacity-0");
    setTimeout(() => applicantModal.classList.add("hidden"), 150);
  }
}

applicantsTableBody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='view']");
  if (!btn) return;

  const id = btn.dataset.id;
  const a = allApplicants.find(item => item.id === id);
  if (a) openApplicantModal(a);
});

btnCloseApplicantModal.addEventListener("click", () => toggleModal(false));

btnSaveAppStatus.addEventListener("click", async () => {
  if (!selectedApplicantId) return;

  btnSaveAppStatus.disabled = true;
  btnSaveAppStatus.textContent = "Saving...";

  const newStatus = modalUpdateStatus.value;

  try {
    const { error } = await supabase
      .from("admissions")
      .update({
        application_status: newStatus,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", selectedApplicantId);

    if (error) throw error;

    toggleModal(false);
    await loadApplicants();
  } catch (err) {
    alert("Failed to update status: " + err.message);
  } finally {
    btnSaveAppStatus.disabled = false;
    btnSaveAppStatus.textContent = "Save Changes";
  }
});

[searchInput, filterClass, filterAppStatus].forEach(el => {
  el?.addEventListener("change", renderApplicants);
  el?.addEventListener("input", renderApplicants);
});

init();
