import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { ensureClassByName } from "/js/shared/schoolContext.js";
import { createAuthUserAsAdmin } from "/js/shared/createAuthUser.js";

const authLoader = document.getElementById("authLoader");
const teachersTableBody = document.getElementById("teachersTableBody");

const teacherModal = document.getElementById("teacherModal");
const modalContent = document.getElementById("modalContent");
const openModalBtn = document.getElementById("openModalBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const teacherForm = document.getElementById("teacherForm");
const formError = document.getElementById("formError");
const modalTitle = document.getElementById("modalTitle");

const editTeacherId = document.getElementById("editTeacherId"); // stores teacher auth uid
const tName = document.getElementById("tName");
const tEmail = document.getElementById("tEmail");
const tPassword = document.getElementById("tPassword");
const passwordWrapper = document.getElementById("passwordWrapper");
const generateTempPasswordBtn = document.getElementById("generateTempPasswordBtn");
const assignmentRows = document.getElementById("assignmentRows");
const addAssignmentRowBtn = document.getElementById("addAssignmentRowBtn");
const subjectOptions = document.getElementById("subjectOptions");
const saveTeacherBtn = document.getElementById("saveTeacherBtn");

function generateTempPassword(length = 12) {
  const targetLength = Math.max(8, Math.min(32, Number(length) || 12));
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%*-_+?";
  const all = upper + lower + digits + symbols;

  const bytes = new Uint8Array(targetLength);
  crypto.getRandomValues(bytes);

  const picks = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digits[bytes[2] % digits.length],
    symbols[bytes[3] % symbols.length],
  ];

  for (let i = picks.length; i < targetLength; i++) {
    picks.push(all[bytes[i] % all.length]);
  }

  for (let i = picks.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }

  return picks.join("");
}

async function revealNewTeacherCredentials({ email, tempPassword }) {
  const loginUrl = `${window.location.origin}/teacher.html`;
  const text = `Teacher account created:\n\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nLogin: ${loginUrl}`;

  try {
    await navigator.clipboard.writeText(text);
    alert("Teacher created. Credentials copied to clipboard.");
  } catch {
    window.prompt("Copy teacher credentials", text);
  }
}

const DEFAULT_SUBJECTS = [
  "English Language",
  "Mathematics",
  "Biology",
  "Chemistry",
  "Physics",
  "Further Mathematics",
  "Agricultural Science",
  "Computer Studies",
  "Civic Education",
  "Economics",
  "Government",
  "Literature in English",
  "Geography",
  "History",
  "Commerce",
  "Accounting",
  "Financial Accounting",
  "Business Studies",
  "Marketing",
  "Technical Drawing",
  "Food and Nutrition",
  "Home Economics",
  "Christian Religious Studies",
  "Islamic Religious Studies",
  "Yoruba",
  "Igbo",
  "Hausa",
  "French",
  "Visual Arts",
  "Music",
];

function toggleModal(show) {
  if (show) {
    teacherModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      teacherModal.classList.remove("opacity-0");
      modalContent.classList.remove("scale-95");
    });
  } else {
    teacherModal.classList.add("opacity-0");
    modalContent.classList.add("scale-95");
    setTimeout(() => teacherModal.classList.add("hidden"), 200);
  }
}

function showFormError(message) {
  formError.textContent = message;
  formError.classList.remove("hidden");
}

function hideFormError() {
  formError.classList.add("hidden");
  formError.textContent = "";
}

function clearAssignmentRows() {
  assignmentRows.innerHTML = "";
}

function createAssignmentRow({ subject = "", className = "" } = {}) {
  const row = document.createElement("div");
  row.className = "grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-center";
  row.innerHTML = `
    <div>
      <label class="block text-[11px] font-semibold text-slate-500 uppercase mb-1 md:hidden">Subject</label>
      <input class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
        placeholder="Subject" list="subjectOptions" data-field="subject" />
    </div>
    <div>
      <label class="block text-[11px] font-semibold text-slate-500 uppercase mb-1 md:hidden">Class</label>
      <input class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
        placeholder="Class (e.g. JSS 1)" data-field="class" />
    </div>
    <div class="flex md:justify-end">
      <button type="button" class="px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg" data-action="remove">Remove</button>
    </div>
  `;
  row.querySelector('[data-field="subject"]').value = subject;
  row.querySelector('[data-field="class"]').value = className;
  row.querySelector('[data-action="remove"]').addEventListener("click", () => row.remove());
  assignmentRows.appendChild(row);
}

function collectAssignmentRows() {
  const rows = Array.from(assignmentRows.querySelectorAll("div"));
  const out = [];
  rows.forEach((row) => {
    const subject = row.querySelector('[data-field="subject"]')?.value?.trim();
    const className = row.querySelector('[data-field="class"]')?.value?.trim();
    if (subject && className) out.push({ subject, className });
  });
  return out;
}

async function assertTeacherEmailIsAvailable(email) {
  const existing = await supabase
    .from("users")
    .select("auth_id, role")
    .eq("email", email)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data?.auth_id) {
    throw new Error(
      existing.data.role === "teacher"
        ? "A teacher with this email already exists. Use Edit to update assignments."
        : "This email is already used by another account."
    );
  }
}

async function ensureSubjectByName(name) {
  const subjectName = String(name || "").trim();
  if (!subjectName) throw new Error("Subject name is required");

  const existing = await supabase.from("subjects").select("id, name").eq("name", subjectName).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const created = await supabase.from("subjects").insert({ name: subjectName }).select("id, name").single();
  if (created.error) throw created.error;
  return created.data;
}

function buildSubjectDatalist() {
  subjectOptions.innerHTML = DEFAULT_SUBJECTS.map((s) => `<option value="${s}"></option>`).join("");
}

function renderTeachers(teachers, assignmentsByTeacher) {
  teachersTableBody.innerHTML = "";
  if (!teachers.length) {
    teachersTableBody.innerHTML =
      '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-500">No teachers found.</td></tr>';
    return;
  }

  teachers.forEach((t) => {
    const summary = assignmentsByTeacher.get(t.auth_id) ?? "No assignments";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-6 py-4 font-medium text-slate-900">${t.display_name ?? ""}</td>
      <td class="px-6 py-4">${t.email ?? ""}</td>
      <td class="px-6 py-4">${summary}</td>
      <td class="px-6 py-4 text-right">
        <button class="text-blue-600 hover:text-blue-800 text-sm font-medium" data-action="edit">Edit</button>
      </td>
    `;
    tr.dataset.teacher = JSON.stringify(t);
    teachersTableBody.appendChild(tr);
  });
}

async function loadTeachers() {
  const { data: teachers, error } = await supabase
    .from("users")
    .select("auth_id, display_name, email, role")
    .eq("role", "teacher")
    .order("display_name", { ascending: true });
  if (error) throw error;

  const teacherIds = (teachers ?? []).map((t) => t.auth_id).filter(Boolean);
  const assignmentsByTeacher = new Map();

  if (teacherIds.length) {
    const a = await supabase
      .from("teacher_assignments")
      .select("teacher_user_id, classes(name), subjects(name)")
      .in("teacher_user_id", teacherIds);
    if (a.error) throw a.error;

    const grouped = new Map(); // teacher -> subject -> set(classes)
    (a.data ?? []).forEach((row) => {
      const teacherId = row.teacher_user_id;
      const subjectName = row.subjects?.name ?? "Subject";
      const className = row.classes?.name ?? "Class";
      if (!grouped.has(teacherId)) grouped.set(teacherId, new Map());
      const subjMap = grouped.get(teacherId);
      if (!subjMap.has(subjectName)) subjMap.set(subjectName, new Set());
      subjMap.get(subjectName).add(className);
    });

    grouped.forEach((subjMap, teacherId) => {
      const parts = [];
      subjMap.forEach((classesSet, subjectName) => {
        const classesList = Array.from(classesSet).sort((x, y) => x.localeCompare(y));
        parts.push(`${subjectName} (${classesList.join(", ")})`);
      });
      assignmentsByTeacher.set(teacherId, parts.join("; "));
    });
  }

  renderTeachers(teachers ?? [], assignmentsByTeacher);
}

function openAddModal() {
  teacherForm.reset();
  clearAssignmentRows();
  createAssignmentRow();
  editTeacherId.value = "";
  modalTitle.textContent = "Add New Teacher";
  passwordWrapper.style.display = "block";
  tPassword.setAttribute("required", "true");
  if (tPassword) tPassword.value = generateTempPassword();
  tEmail.disabled = false;
  hideFormError();
  toggleModal(true);
}

function openEditModal(teacherData) {
  teacherForm.reset();
  clearAssignmentRows();
  hideFormError();

  editTeacherId.value = teacherData.auth_id;
  tName.value = teacherData.display_name ?? "";
  tEmail.value = teacherData.email ?? "";

  modalTitle.textContent = "Edit Teacher Assignments";
  passwordWrapper.style.display = "none";
  tPassword.removeAttribute("required");
  tEmail.disabled = true;

  toggleModal(true);
  loadTeacherAssignmentsIntoModal(teacherData.auth_id).catch((e) => showFormError(e?.message || "Failed to load."));
}

async function loadTeacherAssignmentsIntoModal(teacherId) {
  const { data, error } = await supabase
    .from("teacher_assignments")
    .select("classes(name), subjects(name)")
    .eq("teacher_user_id", teacherId);
  if (error) throw error;

  clearAssignmentRows();
  if (!data?.length) {
    createAssignmentRow();
    return;
  }

  data.forEach((row) =>
    createAssignmentRow({ subject: row.subjects?.name ?? "", className: row.classes?.name ?? "" })
  );
}

teachersTableBody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='edit']");
  if (!btn) return;
  const tr = btn.closest("tr");
  if (!tr?.dataset?.teacher) return;
  openEditModal(JSON.parse(tr.dataset.teacher));
});

openModalBtn.addEventListener("click", openAddModal);
closeModalBtn.addEventListener("click", () => toggleModal(false));
addAssignmentRowBtn.addEventListener("click", () => createAssignmentRow());
generateTempPasswordBtn?.addEventListener("click", () => {
  if (!tPassword) return;
  tPassword.value = generateTempPassword();
  tPassword.focus();
});

teacherForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  saveTeacherBtn.textContent = "Saving...";
  saveTeacherBtn.disabled = true;
  hideFormError();

  try {
    const teacherId = editTeacherId.value;
    const fullName = String(tName.value || "").trim();
    const email = String(tEmail.value || "").trim().toLowerCase();
    let password = String(tPassword.value || "");

    if (!fullName || !email) throw new Error("Name and email are required.");

    let authId = teacherId;
    let createdTempPassword = null;
    if (!teacherId) {
      if (!password) {
        password = generateTempPassword();
        if (tPassword) tPassword.value = password;
      }
      if (password.length < 6) throw new Error("Password must be at least 6 characters.");

      await assertTeacherEmailIsAvailable(email);

      const signUpUser = await createAuthUserAsAdmin({
        email,
        password,
        storageKey: "gracemark-secondary-teachers",
        accountLabel: "teacher email",
      });

      authId = signUpUser.id;
      createdTempPassword = password;
    }

    // Upsert into users profile table
    const upsertProfile = await supabase
      .from("users")
      .upsert({ auth_id: authId, role: "teacher", display_name: fullName, email }, { onConflict: "auth_id" });
    if (upsertProfile.error) throw upsertProfile.error;

    // Replace assignments
    const assignments = collectAssignmentRows();
    await supabase.from("teacher_assignments").delete().eq("teacher_user_id", authId);

    for (const item of assignments) {
      const cls = await ensureClassByName(item.className);
      const subject = await ensureSubjectByName(item.subject);

      const ins = await supabase.from("teacher_assignments").insert({
        teacher_user_id: authId,
        class_id: cls.id,
        subject_id: subject.id,
      });
      if (ins.error) throw ins.error;
    }

    toggleModal(false);
    await loadTeachers();

    if (createdTempPassword) {
      await revealNewTeacherCredentials({ email, tempPassword: createdTempPassword });
    }
  } catch (error) {
    showFormError(error?.message || "Failed to save teacher.");
  } finally {
    saveTeacherBtn.textContent = "Save Teacher";
    saveTeacherBtn.disabled = false;
  }
});

async function init() {
  try {
    buildSubjectDatalist();

    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";
    await loadTeachers();
  } catch (error) {
    console.error("Teachers init error:", error);
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
