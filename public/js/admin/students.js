import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { ensureClassByName } from "/js/shared/schoolContext.js";
import { createStudent } from "/js/admin/crud.js";
import { createAuthUserAsAdmin } from "/js/shared/createAuthUser.js";

const authLoader = document.getElementById("authLoader");
const studentsTableBody = document.getElementById("studentsTableBody");

const studentModal = document.getElementById("studentModal");
const modalContent = document.getElementById("modalContent");
const openModalBtn = document.getElementById("openModalBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const studentForm = document.getElementById("studentForm");
const formError = document.getElementById("formError");
const modalTitle = document.getElementById("modalTitle");

const editStudentId = document.getElementById("editStudentId");
const sName = document.getElementById("sName");
const sAdmNo = document.getElementById("sAdmNo");
const sClass = document.getElementById("sClass");
const classFilter = document.getElementById("classFilter");
const saveStudentBtn = document.getElementById("saveStudentBtn");

const bulkUploadBtn = document.getElementById("bulkUploadBtn");
const bulkUploadInput = document.getElementById("bulkUploadInput");

let allStudentsList = [];

async function populateClassDropdowns() {
  const { data, error } = await supabase
    .from("classes")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching classes:", error);
    return;
  }

  if (!data?.length) {
    sClass.innerHTML = `<option value="">No classes configured</option>`;
    if (classFilter) classFilter.innerHTML = `<option value="">No classes</option>`;
    return;
  }

  const optionsHtml = data
    .map((c) => `<option value="${c.name}">${c.name}</option>`)
    .join("");

  sClass.innerHTML = `<option value="">Select a Class...</option>${optionsHtml}`;
  if (classFilter) {
    classFilter.innerHTML = `<option value="">All Classes</option>${optionsHtml}`;
  }
}

// Initialize the page, check auth, and load initial data
async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";
    await populateClassDropdowns();
    await loadStudents();
  } catch (error) {
    console.error("Students init error:", error);
    if (!authLoader) {
      alert(error?.message || "Failed to verify access.");
      return;
    }

    authLoader.innerHTML = `
      <div class="text-red-500 mb-2">
        <svg class="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
      </div>
      <p class="text-sm font-medium text-slate-800 mb-4 text-center">
        Unable to verify access.<br/>Please check your connection and try again.
      </p>
      <button onclick="window.location.replace('/')" class="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm">
        Return to Login
      </button>
    `;
  }
}
init();

function showFormError(message) {
  formError.textContent = message;
  formError.classList.remove("hidden");
}

function hideFormError() {
  formError.classList.add("hidden");
  formError.textContent = "";
}

function normalizeAdmissionToEmail(admNo) {
  const clean = normalizeAdmissionNo(admNo).replace(/[\/\-_]/g, "");
  if (!clean) return "";
  return `${clean}@student.gracemark.edu.ng`.toLowerCase();
}

function normalizeAdmissionNo(admNo) {
  return String(admNo || "").trim().replace(/\s+/g, "").toUpperCase();
}

function validateAdmissionNo(admNo) {
  const normalized = normalizeAdmissionNo(admNo);
  // Accepts GMA1701, GMA202501, or slashed/hyphenated formats like GMA/2025/001, GM/2025/001, GMA-1701
  if (!/^GMA\d{3,}$/i.test(normalized) && !/^(GMA|GM)[\/-]?\w+[\/-]?\w*$/i.test(normalized)) {
    throw new Error("Admission number must look like GMA1701 or GMA/2025/001.");
  }
  return normalized;
}

async function assertAdmissionNoIsAvailable(admissionNo) {
  const existing = await supabase
    .from("students")
    .select("id")
    .eq("admission_no", admissionNo)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) throw new Error("A student with this admission number already exists.");
}

function toggleModal(show) {
  if (show) {
    studentModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      studentModal.classList.remove("opacity-0");
      modalContent.classList.remove("scale-95");
    });
  } else {
    studentModal.classList.add("opacity-0");
    modalContent.classList.add("scale-95");
    setTimeout(() => studentModal.classList.add("hidden"), 200);
  }
}

function renderStudents(rows) {
  studentsTableBody.innerHTML = "";

  if (!rows.length) {
    studentsTableBody.innerHTML =
      '<tr><td colspan="4" class="px-6 py-8 text-center text-slate-500">No students found.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const className = row.classes?.name ?? "Unassigned";
    tr.innerHTML = `
      <td class="px-6 py-4 font-medium text-slate-900">${row.name ?? ""}</td>
      <td class="px-6 py-4">${row.admission_no ?? ""}</td>
      <td class="px-6 py-4"><span class="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-semibold">${className}</span></td>
      <td class="px-6 py-4 text-right">
        <button class="text-blue-600 hover:text-blue-800 text-sm font-medium" data-action="edit" data-id="${row.id}">Edit</button>
      </td>
    `;
    tr.dataset.student = JSON.stringify({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      admission_no: row.admission_no,
      className,
    });
    studentsTableBody.appendChild(tr);
  });
}

function sortStudents(rows) {
  return [...rows].sort((a, b) => {
    const classCmp = String(a.classes?.name ?? "").localeCompare(String(b.classes?.name ?? ""), undefined, {
      sensitivity: "base",
    });
    if (classCmp !== 0) return classCmp;
    const admCmp = String(a.admission_no ?? "").localeCompare(String(b.admission_no ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (admCmp !== 0) return admCmp;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { sensitivity: "base" });
  });
}

async function loadStudents() {
  const { data, error } = await supabase
    .from("students")
    .select("id, user_id, admission_no, name, class_id, classes(name)");
  if (error) throw error;
  allStudentsList = sortStudents(data ?? []);
  applyClassFilter();
}

function applyClassFilter() {
  const selectedClass = classFilter ? classFilter.value : "";
  if (!selectedClass) {
    renderStudents(allStudentsList);
  } else {
    const filtered = allStudentsList.filter((s) => s.classes?.name === selectedClass);
    renderStudents(filtered);
  }
}

classFilter?.addEventListener("change", applyClassFilter);

function openAddModal() {
  studentForm.reset();
  editStudentId.value = "";
  modalTitle.textContent = "Add New Student";
  sAdmNo.disabled = false;
  sAdmNo.placeholder = "e.g. GMA1701";
  hideFormError();
  toggleModal(true);
}

function openEditModal(studentData) {
  studentForm.reset();
  hideFormError();

  editStudentId.value = studentData.id;
  sName.value = studentData.name ?? "";
  sAdmNo.value = studentData.admission_no ?? "";
  sClass.value = studentData.className ?? "";

  modalTitle.textContent = "Edit Student Details";
  sAdmNo.disabled = true;
  toggleModal(true);
}

studentsTableBody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='edit']");
  if (!btn) return;
  const tr = btn.closest("tr");
  if (!tr?.dataset?.student) return;
  openEditModal(JSON.parse(tr.dataset.student));
});

openModalBtn.addEventListener("click", openAddModal);
closeModalBtn.addEventListener("click", () => toggleModal(false));

studentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  saveStudentBtn.textContent = "Saving...";
  saveStudentBtn.disabled = true;
  hideFormError();

  try {
    const id = editStudentId.value;
    const name = String(sName.value || "").trim();
    const admissionNo = validateAdmissionNo(sAdmNo.value);
    const className = String(sClass.value || "").trim();

    if (!name || !admissionNo || !className) {
      showFormError("Name, admission number, and class are required.");
      return;
    }

    let { data: cls } = await supabase
      .from("classes")
      .select("id")
      .eq("name", className)
      .limit(1)
      .maybeSingle();

    if (!cls?.id) {
      cls = await ensureClassByName(className);
    }

    if (!id) {
      const email = normalizeAdmissionToEmail(admissionNo);
      if (!email) throw new Error("Invalid admission number.");

      await assertAdmissionNoIsAvailable(admissionNo);

      const signUpUser = await createAuthUserAsAdmin({
        email,
        password: "gracemark",
        storageKey: "gracemark-secondary-students",
        accountLabel: "student admission number",
      });

      // Ensure the profile/role row exists (requires your `users` table to have `auth_id` unique)
      const upsertProfile = await supabase
        .from("users")
        .upsert(
          { auth_id: signUpUser.id, role: "student", display_name: name, email },
          { onConflict: "auth_id" }
        );
      if (upsertProfile.error) throw upsertProfile.error;

      await createStudent({
        class_id: cls.id,
        user_id: signUpUser.id,
        admission_no: admissionNo,
        name,
      });
    } else {
      // Update existing student record
      const { error } = await supabase
        .from("students")
        .update({ name, class_id: cls.id })
        .eq("id", id);
      if (error) throw error;

      const studentUserId = JSON.parse(studentsTableBody.querySelector(`button[data-id="${id}"]`)?.closest("tr")?.dataset?.student || "{}").user_id;
      if (studentUserId) {
        const profileUpdate = await supabase.from("users").update({ display_name: name }).eq("auth_id", studentUserId);
        if (profileUpdate.error) throw profileUpdate.error;
      }
    }

    toggleModal(false);
    await loadStudents();
  } catch (error) {
    showFormError(error?.message || "Failed to save student.");
  } finally {
    saveStudentBtn.textContent = "Save Student";
    saveStudentBtn.disabled = false;
  }
});

// Bulk Upload
bulkUploadBtn?.addEventListener("click", () => bulkUploadInput?.click());

bulkUploadInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  authLoader.querySelector("p").textContent = "Processing Bulk Upload... Please wait.";
  authLoader.style.display = "flex";

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const bytes = new Uint8Array(event.target.result);
      const workbook = window.XLSX.read(bytes, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = window.XLSX.utils.sheet_to_json(worksheet);

      let successCount = 0;
      let failCount = 0;
      const errorSamples = [];

      for (const row of rows) {
        const name = row["Name"] || row["name"] || row["Student Name"] || row["student name"];
        const className = row["Class"] || row["class"] || "Unassigned";
        const rawAdmNo =
          row["Admission Number"] ||
          row["admission number"] ||
          row["Admission No"] ||
          row["admission no"] ||
          row["Adm No"] ||
          row["adm no"];

        if (!name) continue;

        try {
          const admissionNo = rawAdmNo ? validateAdmissionNo(rawAdmNo) : "";
          if (!admissionNo) throw new Error("Admission number is required.");
          const email = normalizeAdmissionToEmail(admissionNo);

          const cls = await ensureClassByName(className);

          await assertAdmissionNoIsAvailable(admissionNo);

          const signUpUser = await createAuthUserAsAdmin({
            email,
            password: "gracemark",
            storageKey: "gracemark-secondary-students",
            accountLabel: "student admission number",
          });

          const upsertProfile = await supabase
            .from("users")
            .upsert(
              { auth_id: signUpUser.id, role: "student", display_name: String(name).trim(), email },
              { onConflict: "auth_id" }
            );
          if (upsertProfile.error) throw upsertProfile.error;

          await createStudent({
            class_id: cls.id,
            user_id: signUpUser.id,
            admission_no: admissionNo,
            name: String(name).trim(),
          });

          successCount++;
        } catch (err) {
          console.warn("Skipped row:", name, err?.message);
          failCount++;
          if (errorSamples.length < 3) {
            errorSamples.push(`${name} (${rawAdmNo ?? "no adm"}): ${err?.message || "Failed"}`);
          }
        }
      }

      authLoader.style.display = "none";
      const errorDetail = errorSamples.length ? `\n\nSample errors:\n- ${errorSamples.join("\n- ")}` : "";
      alert(`Bulk upload complete!\nSuccessfully added: ${successCount}\nFailed: ${failCount}${errorDetail}`);
      await loadStudents();
    } catch (parseError) {
      console.error("Error parsing Excel file:", parseError);
      alert("Failed to read the file. Ensure it is a valid Excel spreadsheet.");
      authLoader.style.display = "none";
    }
  };
  reader.readAsArrayBuffer(file);
});
