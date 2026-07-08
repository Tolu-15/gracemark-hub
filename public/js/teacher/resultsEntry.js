import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings } from "/js/shared/appSettings.js";
import { getClassByName } from "/js/shared/schoolContext.js";
import {
  GRADING_CONFIG,
  calculateStudentResult,
  emptyRawScores,
  normalizeBreakdown,
  toStoredScores,
  validateRawScores,
} from "/shared/gradingEngine.js";

const classSelect = document.getElementById("classSelect");
const subjectSelect = document.getElementById("subjectSelect");
const scoreTableBody = document.getElementById("scoreTableBody");
const scoreCardsMobile = document.getElementById("scoreCardsMobile");
const saveStatus = document.getElementById("saveStatus");
const btnSaveDraft = document.getElementById("btnSaveDraft");
const btnPublish = document.getElementById("btnPublish");

const COL_COUNT = 24;

let gridHasInvalid = false;

function termLabel(term) {
  if (term === "term1") return "1st Term";
  if (term === "term2") return "2nd Term";
  if (term === "term3") return "3rd Term";
  return term || "—";
}

function compareStudents(a, b) {
  const admCmp = String(a.admission_no ?? "").localeCompare(String(b.admission_no ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (admCmp !== 0) return admCmp;
  return String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { sensitivity: "base" });
}

function statusBadge(status) {
  const s = String(status || "draft").toLowerCase();
  const styles = {
    draft: "bg-slate-100 text-slate-600 ring-slate-200",
    published: "bg-amber-50 text-amber-800 ring-amber-200",
    approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  };
  const labels = { draft: "Draft", published: "Published", approved: "Approved" };
  const cls = styles[s] || styles.draft;
  const label = labels[s] || s;
  return `<span class="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${cls}">${label}</span>`;
}

function renderEmpty(message) {
  if (scoreTableBody) {
    scoreTableBody.innerHTML = `<tr><td colspan="${COL_COUNT}" class="p-8 text-center text-slate-500">${message}</td></tr>`;
  }
  if (scoreCardsMobile) {
    scoreCardsMobile.innerHTML = `<p class="p-6 text-center text-slate-500 bg-white rounded-xl border border-slate-200">${message}</p>`;
  }
}

function getSavePanels() {
  return [...scoreTableBody.querySelectorAll("tr[data-student-id]")];
}

function getActivePanels() {
  if (window.matchMedia("(max-width: 767px)").matches && scoreCardsMobile) {
    return [...scoreCardsMobile.querySelectorAll("[data-student-id]")];
  }
  return getSavePanels();
}

function defaultStatusMessage(panels) {
  return panels.length
    ? "Ready to save. Blanks are ignored; type 0 for zero."
    : "Select a class and subject.";
}

function syncInputValue(input) {
  const panel = input.closest("[data-student-id]");
  if (!panel) return;
  const { studentId } = panel.dataset;
  const field = input.dataset.field;
  document
    .querySelectorAll(`[data-student-id="${studentId}"] input[data-field="${field}"]`)
    .forEach((el) => {
      if (el !== input) el.value = input.value;
    });
}

function syncRecalcForStudent(studentId) {
  document.querySelectorAll(`[data-student-id="${studentId}"]`).forEach((panel) => recalcPanel(panel));
}

function scoreInput(name, value, max) {
  const v = value === null || value === undefined || value === "" ? "" : String(value);
  return `<input data-field="${name}" data-max="${max}" type="number" min="0" max="${max}" step="0.1" value="${v}" class="score-input" placeholder="—" />`;
}

function readRawScoresFromPanel(panel) {
  const raw = emptyRawScores();
  for (let i = 0; i < GRADING_CONFIG.cw.count; i++) {
    raw.cw[i] = panel.querySelector(`[data-field="cw${i + 1}"]`)?.value ?? "";
  }
  for (let i = 0; i < GRADING_CONFIG.hw.count; i++) {
    raw.hw[i] = panel.querySelector(`[data-field="hw${i + 1}"]`)?.value ?? "";
  }
  for (let i = 0; i < GRADING_CONFIG.tests.maxes.length; i++) {
    raw.tests[i] = panel.querySelector(`[data-field="test${i + 1}"]`)?.value ?? "";
  }
  raw.project = panel.querySelector('[data-field="project"]')?.value ?? "";
  raw.exam = panel.querySelector('[data-field="exam"]')?.value ?? "";
  return raw;
}

function applyInputValidation(panel, validation) {
  panel.querySelectorAll("input[data-field]").forEach((input) => {
    input.classList.remove("score-input--invalid");
    const max = Number(input.dataset.max);
    const val = input.value;
    if (val === "" || val === null || val === undefined) return;
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0 || num > max) {
      input.classList.add("score-input--invalid");
    }
  });

  validation.issues.forEach((issue) => {
    let selector = "";
    if (issue.field === "cw") selector = `[data-field="cw${issue.index + 1}"]`;
    if (issue.field === "hw") selector = `[data-field="hw${issue.index + 1}"]`;
    if (issue.field === "tests") selector = `[data-field="test${issue.index + 1}"]`;
    if (issue.field === "project") selector = '[data-field="project"]';
    if (issue.field === "exam") selector = '[data-field="exam"]';
    panel.querySelector(selector)?.classList.add("score-input--invalid");
  });
}

function recalcPanel(panel) {
  const raw = readRawScoresFromPanel(panel);
  const validation = validateRawScores(raw);
  applyInputValidation(panel, validation);

  const result = calculateStudentResult(raw);
  const stored = toStoredScores(result);

  panel.querySelector('[data-out="cw"]').textContent = String(stored.cw);
  panel.querySelector('[data-out="hw"]').textContent = String(stored.hw);
  panel.querySelector('[data-out="tests"]').textContent = String(stored.test);
  panel.querySelector('[data-out="ca"]').textContent = String(Math.round(result.caTotal));
  panel.querySelector('[data-out="total"]').textContent = String(stored.total);
  panel.querySelector('[data-out="grade"]').textContent = stored.grade;

  panel.dataset.invalid = validation.valid ? "0" : "1";
  return validation.valid;
}

function refreshGridValidationState(options = {}) {
  const panels = getSavePanels();
  panels.forEach((panel) => recalcPanel(panel));

  gridHasInvalid = panels.some((p) => p.dataset.invalid === "1");
  const canSave = !gridHasInvalid && panels.length > 0;

  if (btnSaveDraft) btnSaveDraft.disabled = !canSave;
  if (btnPublish) btnPublish.disabled = !canSave;

  if (!saveStatus) return;

  if (gridHasInvalid) {
    saveStatus.textContent = "Fix red scores (over max) before saving.";
    saveStatus.classList.add("text-red-600");
    return;
  }

  saveStatus.classList.remove("text-red-600");
  if (options.skipMessage) return;
  if (options.message !== undefined) {
    saveStatus.textContent = options.message;
    return;
  }

  const current = saveStatus.textContent || "";
  if (
    current === "Fix red scores (over max) before saving." ||
    current.endsWith("Save failed.") ||
    current.endsWith("Publish failed.")
  ) {
    saveStatus.textContent = defaultStatusMessage(panels);
  }
}

function scoreFieldCell(name, value, max) {
  return `<td class="score-cell score-cell--input">${scoreInput(name, value, max)}</td>`;
}

function buildRow(student, existing, rowIndex) {
  const tr = document.createElement("tr");
  tr.className = "hover:bg-slate-50/50";
  tr.dataset.studentId = student.id;
  tr.dataset.resultId = existing?.id ?? "";
  tr.dataset.status = existing?.status ?? "draft";

  const raw = normalizeBreakdown(existing);
  const preview = calculateStudentResult(raw);
  const stored = toStoredScores(preview);
  const status = tr.dataset.status;

  const cwTds = raw.cw
    .map((v, i) => scoreFieldCell(`cw${i + 1}`, v, GRADING_CONFIG.cw.itemMax))
    .join("");
  const hwTds = raw.hw
    .map((v, i) => scoreFieldCell(`hw${i + 1}`, v, GRADING_CONFIG.hw.itemMax))
    .join("");
  const testTds = raw.tests
    .map((v, i) => scoreFieldCell(`test${i + 1}`, v, GRADING_CONFIG.tests.maxes[i]))
    .join("");

  tr.innerHTML = `
    <td class="score-cell score-cell--index sticky-col sticky-col--index">${rowIndex}</td>
    <td class="score-cell score-cell--student sticky-col sticky-col--student">
      <div class="leading-tight truncate" title="${student.name ?? ""}">
        <div class="font-medium text-slate-900 text-[0.7rem]">${student.name ?? ""}</div>
        <div class="text-[0.6rem] text-slate-500 font-mono">${student.admission_no ?? ""}</div>
      </div>
    </td>
    ${cwTds}
    ${hwTds}
    ${testTds}
    <td class="score-cell score-cell--input border-l border-slate-100">${scoreInput("project", raw.project, GRADING_CONFIG.project.max)}</td>
    <td class="score-cell score-cell--input">${scoreInput("exam", raw.exam, GRADING_CONFIG.exam.max)}</td>
    <td class="score-cell score-cell--computed border-l border-slate-100" data-out="cw">${stored.cw}</td>
    <td class="score-cell score-cell--computed" data-out="hw">${stored.hw}</td>
    <td class="score-cell score-cell--computed" data-out="tests">${stored.test}</td>
    <td class="score-cell score-cell--computed" data-out="ca">${Math.round(preview.caTotal)}</td>
    <td class="score-cell score-cell--total" data-out="total">${stored.total}</td>
    <td class="score-cell score-cell--grade" data-out="grade">${stored.grade}</td>
    <td class="score-cell score-cell--status" data-out="status">${statusBadge(status)}</td>
  `;

  recalcPanel(tr);
  return tr;
}

function mobileFieldGroup(label, name, value, max) {
  return `
    <div class="score-card__field">
      <label>${label}</label>
      ${scoreInput(name, value, max)}
    </div>
  `;
}

function buildMobileCard(student, existing, rowIndex) {
  const card = document.createElement("article");
  card.className = "score-card";
  card.dataset.studentId = student.id;
  card.dataset.resultId = existing?.id ?? "";
  card.dataset.status = existing?.status ?? "draft";

  const raw = normalizeBreakdown(existing);
  const preview = calculateStudentResult(raw);
  const stored = toStoredScores(preview);
  const status = card.dataset.status;

  const cwFields = raw.cw
    .map((v, i) => mobileFieldGroup(i + 1, `cw${i + 1}`, v, GRADING_CONFIG.cw.itemMax))
    .join("");
  const hwFields = raw.hw
    .map((v, i) => mobileFieldGroup(i + 1, `hw${i + 1}`, v, GRADING_CONFIG.hw.itemMax))
    .join("");
  const testFields = raw.tests
    .map((v, i) => mobileFieldGroup(["15", "15", "30"][i], `test${i + 1}`, v, GRADING_CONFIG.tests.maxes[i]))
    .join("");

  card.innerHTML = `
    <div class="score-card__head">
      <div>
        <div class="score-card__name">#${rowIndex} · ${student.name ?? ""}</div>
        <div class="score-card__adm">${student.admission_no ?? ""}</div>
      </div>
      <span data-out="status">${statusBadge(status)}</span>
    </div>
    <div class="score-card__section">
      <div class="score-card__section-title">Classwork (max 10)</div>
      <div class="score-card__grid">${cwFields}</div>
    </div>
    <div class="score-card__section">
      <div class="score-card__section-title">Assignment (max 10)</div>
      <div class="score-card__grid">${hwFields}</div>
    </div>
    <div class="score-card__section">
      <div class="score-card__section-title">Tests</div>
      <div class="score-card__grid score-card__grid--3">${testFields}</div>
    </div>
    <div class="score-card__section">
      <div class="score-card__section-title">Project & Exam</div>
      <div class="score-card__grid score-card__grid--2">
        ${mobileFieldGroup("Proj /5", "project", raw.project, GRADING_CONFIG.project.max)}
        ${mobileFieldGroup("Exam /70", "exam", raw.exam, GRADING_CONFIG.exam.max)}
      </div>
    </div>
    <div class="score-card__summary">
      <div class="score-card__stat">Total<strong data-out="total">${stored.total}</strong></div>
      <div class="score-card__stat">CA<strong data-out="ca">${Math.round(preview.caTotal)}</strong></div>
      <div class="score-card__stat">Grade<strong data-out="grade">${stored.grade}</strong></div>
    </div>
    <div class="hidden" aria-hidden="true">
      <span data-out="cw">${stored.cw}</span>
      <span data-out="hw">${stored.hw}</span>
      <span data-out="tests">${stored.test}</span>
    </div>
  `;

  recalcPanel(card);
  return card;
}

async function loadAssignments(teacherAuthId) {
  const { data, error } = await supabase
    .from("teacher_assignments")
    .select("class_id, subject_id, classes(name), subjects(name)")
    .eq("teacher_user_id", teacherAuthId);
  if (error) throw error;
  return data ?? [];
}

function populateClassSelect(assignments) {
  const classNames = Array.from(new Set(assignments.map((a) => a.classes?.name).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

  classSelect.innerHTML = classNames.map((c) => `<option value="${c}">${c}</option>`).join("");
  classSelect.disabled = classNames.length === 0;
}

function populateSubjectSelect(assignments, className) {
  const subjects = assignments
    .filter((a) => a.classes?.name === className)
    .map((a) => ({ id: a.subject_id, name: a.subjects?.name }))
    .filter((s) => s.id && s.name);

  const unique = new Map();
  subjects.forEach((s) => unique.set(s.id, s.name));

  subjectSelect.innerHTML = Array.from(unique.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${id}">${name}</option>`)
    .join("");

  subjectSelect.disabled = unique.size === 0;
}

async function fetchStudentsForClassId(classId) {
  const { data, error } = await supabase
    .from("students")
    .select("id, name, admission_no")
    .eq("class_id", classId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function fetchResults({ studentIds, subjectId, term }) {
  if (!studentIds.length) return [];
  let selectCols =
    "id, student_id, subject_id, term, cw, hw, test, project, exam, total, grade, status, score_breakdown";
  let { data, error } = await supabase
    .from("results")
    .select(selectCols)
    .eq("subject_id", subjectId)
    .eq("term", term)
    .in("student_id", studentIds);
  if (error && /score_breakdown/i.test(error.message || "")) {
    selectCols = "id, student_id, subject_id, term, cw, hw, test, project, exam, total, grade, status";
    ({ data, error } = await supabase
      .from("results")
      .select(selectCols)
      .eq("subject_id", subjectId)
      .eq("term", term)
      .in("student_id", studentIds));
  }
  if (error) throw error;
  return data ?? [];
}

async function renderGrid({ className, subjectId, term, statusMessage } = {}) {
  const cls = await getClassByName(className);
  if (!cls?.id) {
    renderEmpty("Class not found. Ask admin to create it first.");
    refreshGridValidationState();
    return;
  }

  let students = await fetchStudentsForClassId(cls.id);
  students = [...students].sort(compareStudents);
  if (!students.length) {
    renderEmpty("No students found in this class.");
    refreshGridValidationState();
    return;
  }

  const results = await fetchResults({ studentIds: students.map((s) => s.id), subjectId, term });
  const resultsByStudent = new Map(results.map((r) => [r.student_id, r]));

  scoreTableBody.innerHTML = "";
  if (scoreCardsMobile) scoreCardsMobile.innerHTML = "";

  students.forEach((s, i) => {
    const existing = resultsByStudent.get(s.id);
    const idx = i + 1;
    scoreTableBody.appendChild(buildRow(s, existing, idx));
    if (scoreCardsMobile) scoreCardsMobile.appendChild(buildMobileCard(s, existing, idx));
  });
  refreshGridValidationState({
    message: statusMessage ?? "Loaded. Blanks are ignored; type 0 for zero.",
  });
}

async function saveAll({ teacherAuthId, status }) {
  const panels = getSavePanels();
  if (!panels.length) return;

  panels.forEach((panel) => recalcPanel(panel));

  for (const panel of panels) {
    if (panel.dataset.invalid === "1") {
      throw new Error("Some scores exceed the maximum. Fix red cells before saving.");
    }
  }

  const settings = await getAppSettings();
  const term = settings?.current_term ?? "term1";
  const className = classSelect.value;
  const subjectId = subjectSelect.value;
  if (!className || !subjectId) return;

  saveStatus.textContent = status === "published" ? "Publishing..." : "Saving draft...";
  saveStatus.classList.remove("text-red-600");

  const payload = panels.map((panel) => {
    const raw = readRawScoresFromPanel(panel);
    const validation = validateRawScores(raw);
    if (!validation.valid) {
      throw new Error("Some scores exceed the maximum. Fix red cells before saving.");
    }

    const result = calculateStudentResult(raw);
    const stored = toStoredScores(result);

    return {
      student_id: panel.dataset.studentId,
      subject_id: subjectId,
      term,
      submitted_by: teacherAuthId,
      status,
      score_breakdown: raw,
      cw: stored.cw,
      hw: stored.hw,
      test: stored.test,
      project: stored.project,
      exam: stored.exam,
      total: stored.total,
      grade: stored.grade,
    };
  });

  let { error } = await supabase.from("results").upsert(payload, { onConflict: "student_id,subject_id,term" });
  if (error && /score_breakdown/i.test(error.message || "")) {
    const fallbackPayload = payload.map(({ score_breakdown, ...rest }) => rest);
    ({ error } = await supabase.from("results").upsert(fallbackPayload, { onConflict: "student_id,subject_id,term" }));
    if (!error) {
      console.warn("Saved without score_breakdown — run supabase/patch_existing.sql to store raw scores.");
    }
  }
  if (error) throw error;

  const publishedMsg =
    status === "published"
      ? "Published to Admin. Students see scores after admin approval."
      : "Draft saved.";
  await renderGrid({ className, subjectId, term, statusMessage: publishedMsg });
}

export async function startResultsEntry() {
  const ok = await requireRole("teacher", { redirectTo: "/" });
  if (!ok) return;

  const settings = await getAppSettings();
  const term = settings?.current_term ?? "term1";

  const termDisplay = document.getElementById("displayTerm");
  if (termDisplay) termDisplay.textContent = termLabel(term);

  const assignments = await loadAssignments(ok.session.user.id);
  populateClassSelect(assignments);

  const selectedClass = classSelect.value || assignments[0]?.classes?.name || "";
  if (selectedClass) {
    classSelect.value = selectedClass;
    populateSubjectSelect(assignments, selectedClass);
  }

  const selectedSubjectId =
    subjectSelect.value || assignments.find((a) => a.classes?.name === selectedClass)?.subject_id;
  if (selectedSubjectId) subjectSelect.value = selectedSubjectId;

  classSelect.addEventListener("change", async () => {
    populateSubjectSelect(assignments, classSelect.value);
    await renderGrid({ className: classSelect.value, subjectId: subjectSelect.value, term });
  });

  subjectSelect.addEventListener("change", async () => {
    await renderGrid({ className: classSelect.value, subjectId: subjectSelect.value, term });
  });

  function handleScoreInput(e) {
    const inputEl = e.target.closest("input[data-field]");
    if (!inputEl) return;
    const panel = inputEl.closest("[data-student-id]");
    if (!panel) return;
    syncInputValue(inputEl);
    syncRecalcForStudent(panel.dataset.studentId);
    refreshGridValidationState();
    if (!gridHasInvalid) {
      saveStatus.textContent = "Unsaved changes…";
      saveStatus.classList.remove("text-red-600");
    }
  }

  scoreTableBody.addEventListener("input", handleScoreInput);
  scoreCardsMobile?.addEventListener("input", handleScoreInput);

  btnSaveDraft?.addEventListener("click", async () => {
    if (gridHasInvalid) return;
    btnSaveDraft.disabled = true;
    btnPublish.disabled = true;
    try {
      await saveAll({ teacherAuthId: ok.session.user.id, status: "draft" });
    } catch (error) {
      alert(error?.message || "Failed to save draft.");
      saveStatus.textContent = error?.message || "Save failed.";
      saveStatus.classList.add("text-red-600");
    } finally {
      refreshGridValidationState({ skipMessage: true });
    }
  });

  btnPublish?.addEventListener("click", async () => {
    if (gridHasInvalid) return;
    btnSaveDraft.disabled = true;
    btnPublish.disabled = true;
    try {
      await saveAll({ teacherAuthId: ok.session.user.id, status: "published" });
    } catch (error) {
      alert(error?.message || "Failed to publish.");
      saveStatus.textContent = error?.message || "Publish failed.";
      saveStatus.classList.add("text-red-600");
    } finally {
      refreshGridValidationState({ skipMessage: true });
    }
  });

  await renderGrid({ className: classSelect.value, subjectId: subjectSelect.value, term });
}
