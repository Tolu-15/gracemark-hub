import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings } from "/js/shared/appSettings.js";
import { signOut } from "/js/shared/auth.js";

const authLoader = document.getElementById("authLoader");
const logoutBtn = document.getElementById("logoutBtn");
const classSelect = document.getElementById("classSelect");
const termSelect = document.getElementById("termSelect");
const evaluationTableBody = document.getElementById("evaluationTableBody");
const btnSaveEvaluations = document.getElementById("btnSaveEvaluations");
const saveStatus = document.getElementById("saveStatus");

let currentAdminUser = null;
let currentSession = "";
let studentList = [];
let existingEvaluationsMap = new Map(); // student_id -> evaluation_record

function traitSelectOptions(currentVal) {
  let html = `<option value="">—</option>`;
  for (let i = 1; i <= 5; i++) {
    const selected = Number(currentVal) === i ? "selected" : "";
    html += `<option value="${i}" ${selected}>${i}</option>`;
  }
  return html;
}

function renderTable() {
  if (!studentList.length) {
    evaluationTableBody.innerHTML = `<tr><td colspan="13" class="px-6 py-8 text-center text-slate-500">No active students found in this class.</td></tr>`;
    return;
  }

  evaluationTableBody.innerHTML = studentList.map((s) => {
    const ev = existingEvaluationsMap.get(s.id) || {};
    return `
      <tr class="hover:bg-slate-50/50 border-b border-slate-100" data-student-id="${s.id}">
        <td class="px-4 py-4 sticky left-0 bg-white border-r border-slate-100 font-medium text-slate-900 z-10">
          <div class="leading-tight">
            <div>${s.name}</div>
            <div class="text-[10px] text-slate-500 font-mono">${s.admission_no}</div>
          </div>
        </td>
        <td class="px-1 py-3 text-center"><select data-trait="punctuality" class="trait-select">${traitSelectOptions(ev.punctuality)}</select></td>
        <td class="px-1 py-3 text-center"><select data-trait="neatness" class="trait-select">${traitSelectOptions(ev.neatness)}</select></td>
        <td class="px-1 py-3 text-center"><select data-trait="honesty" class="trait-select">${traitSelectOptions(ev.honesty)}</select></td>
        <td class="px-1 py-3 text-center"><select data-trait="politeness" class="trait-select">${traitSelectOptions(ev.politeness)}</select></td>
        <td class="px-1 py-3 text-center"><select data-trait="cooperation" class="trait-select">${traitSelectOptions(ev.cooperation)}</select></td>
        <td class="px-1 py-3 text-center"><select data-trait="leadership" class="trait-select">${traitSelectOptions(ev.leadership)}</select></td>
        <td class="px-1 py-3 text-center"><select data-trait="handwriting" class="trait-select">${traitSelectOptions(ev.handwriting)}</select></td>
        <td class="px-1 py-3 text-center"><select data-trait="sports" class="trait-select">${traitSelectOptions(ev.sports)}</select></td>
        <td class="px-1 py-3 text-center"><select data-trait="crafts" class="trait-select">${traitSelectOptions(ev.crafts)}</select></td>
        <td class="px-1 py-3 text-center"><select data-trait="music" class="trait-select">${traitSelectOptions(ev.music)}</select></td>
        <td class="px-2 py-3">
          <input type="text" data-remark="teacher" value="${ev.teacher_remark || ""}" class="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" placeholder="Form teacher remark..." />
        </td>
        <td class="px-2 py-3">
          <input type="text" data-remark="principal" value="${ev.principal_remark || ""}" class="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" placeholder="Principal remark..." />
        </td>
      </tr>
    `;
  }).join("");
}

async function loadAllClasses() {
  const { data: classes, error } = await supabase
    .from("classes")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;

  if (!classes?.length) {
    classSelect.innerHTML = `<option value="">No classes configured</option>`;
    classSelect.disabled = true;
    return;
  }

  classSelect.disabled = false;
  classSelect.innerHTML = classes
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");
}

async function loadData() {
  const classId = classSelect.value;
  const term = termSelect.value;
  if (!classId || !term) return;

  evaluationTableBody.innerHTML = `<tr><td colspan="13" class="px-6 py-8 text-center text-slate-500">Loading class evaluation records...</td></tr>`;

  try {
    // 1. Load active class students
    const { data: students, error: stdErr } = await supabase
      .from("students")
      .select("id, name, admission_no")
      .eq("class_id", classId)
      .eq("is_alumni", false)
      .order("name", { ascending: true });

    if (stdErr) throw stdErr;
    studentList = students || [];

    // 2. Load existing evaluations
    const studentIds = studentList.map(s => s.id);
    existingEvaluationsMap.clear();

    if (studentIds.length) {
      const { data: evals, error: evErr } = await supabase
        .from("student_evaluations")
        .select("*")
        .in("student_id", studentIds)
        .eq("term", term)
        .eq("session", currentSession);

      if (evErr) throw evErr;
      (evals || []).forEach((ev) => {
        existingEvaluationsMap.set(ev.student_id, ev);
      });
    }

    renderTable();
  } catch (error) {
    console.error("Admin Load evaluations error:", error);
    evaluationTableBody.innerHTML = `<tr><td colspan="13" class="px-6 py-8 text-center text-red-500">Failed to load evaluations: ${error.message}</td></tr>`;
  }
}

async function saveEvaluations() {
  const classId = classSelect.value;
  const term = termSelect.value;
  if (!classId || !term) return;

  btnSaveEvaluations.disabled = true;
  btnSaveEvaluations.textContent = "Saving...";
  saveStatus.textContent = "Saving student evaluations...";
  saveStatus.className = "text-sm font-medium text-slate-500";

  const rows = Array.from(evaluationTableBody.querySelectorAll("tr[data-student-id]"));
  const payload = [];

  rows.forEach((tr) => {
    const studentId = tr.dataset.studentId;
    const ev = existingEvaluationsMap.get(studentId) || {};
    
    const record = {
      student_id: studentId,
      term,
      session: currentSession,
      submitted_by: currentAdminUser.id,
      
      neatness: parseInt(tr.querySelector('[data-trait="neatness"]').value) || null,
      honesty: parseInt(tr.querySelector('[data-trait="honesty"]').value) || null,
      punctuality: parseInt(tr.querySelector('[data-trait="punctuality"]').value) || null,
      politeness: parseInt(tr.querySelector('[data-trait="politeness"]').value) || null,
      cooperation: parseInt(tr.querySelector('[data-trait="cooperation"]').value) || null,
      leadership: parseInt(tr.querySelector('[data-trait="leadership"]').value) || null,
      
      handwriting: parseInt(tr.querySelector('[data-trait="handwriting"]').value) || null,
      sports: parseInt(tr.querySelector('[data-trait="sports"]').value) || null,
      crafts: parseInt(tr.querySelector('[data-trait="crafts"]').value) || null,
      music: parseInt(tr.querySelector('[data-trait="music"]').value) || null,
      
      teacher_remark: tr.querySelector('[data-remark="teacher"]').value.trim() || null,
      principal_remark: tr.querySelector('[data-remark="principal"]').value.trim() || null,
    };

    if (ev.id) record.id = ev.id;
    payload.push(record);
  });

  try {
    const { error } = await supabase
      .from("student_evaluations")
      .upsert(payload, { onConflict: "student_id,term,session" });

    if (error) throw error;

    saveStatus.textContent = "Student remarks & evaluations saved successfully!";
    saveStatus.className = "text-sm font-semibold text-emerald-600";
    await loadData();
  } catch (error) {
    console.error("Admin save evaluations error:", error);
    saveStatus.textContent = "Save failed: " + error.message;
    saveStatus.className = "text-sm font-semibold text-red-600";
  } finally {
    btnSaveEvaluations.disabled = false;
    btnSaveEvaluations.textContent = "Save Changes";
  }
}

classSelect.addEventListener("change", loadData);
termSelect.addEventListener("change", loadData);
btnSaveEvaluations.addEventListener("click", saveEvaluations);

logoutBtn?.addEventListener("click", async () => {
  await signOut();
  window.location.replace("/");
});

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    currentAdminUser = ok.user;

    const settings = await getAppSettings();
    currentSession = settings?.current_session || "";
    const term = settings?.current_term || "term1";
    termSelect.value = term;

    await loadAllClasses();
    await loadData();

    authLoader.style.display = "none";
  } catch (error) {
    console.error("Admin remarks init error:", error);
    authLoader.innerHTML = `
      <p class="text-sm font-medium text-slate-800 mb-4 text-center">Cannot connect to evaluations database.</p>
      <button onclick="window.location.replace('/')" class="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm">Return to Login</button>
    `;
  }
}

init();
