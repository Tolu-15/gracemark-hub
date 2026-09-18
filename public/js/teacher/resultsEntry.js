import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings } from "/js/shared/appSettings.js";
import { getClassByName } from "/js/shared/schoolContext.js";
import {
  GRADING_CONFIG,
  calculatePR1,
  calculatePR2,
  calculatePR3,
  calculateTR,
  calculateStudentResult,
  emptyRawScores,
  normalizeBreakdown,
  toStoredScores,
  validateRawScores,
} from "/shared/gradingEngine.js";

const classSelect = document.getElementById("classSelect");
const subjectSelect = document.getElementById("subjectSelect");
const termSelect = document.getElementById("termSelect");
const scoreTableBody = document.getElementById("scoreTableBody");
const scoreCardsMobile = document.getElementById("scoreCardsMobile");
const saveStatus = document.getElementById("saveStatus");
const btnSaveDraft = document.getElementById("btnSaveDraft");
const btnSubmit = document.getElementById("btnSubmit");
const returnReasonBanner = document.getElementById("returnReasonBanner");
const returnReasonText = document.getElementById("returnReasonText");
const termLockBanner = document.getElementById("termLockBanner");
const termLockIcon = document.getElementById("termLockIcon");
const termLockText = document.getElementById("termLockText");
const termLockBadge = document.getElementById("termLockBadge");

const COL_COUNT = 32;

let gridHasInvalid = false;
let currentView = "all";

let termMeta = {
  currentTerm: "term1",
  currentSession: "2025/2026",
  termsList: [],
};

async function loadTermsMetadata() {
  try {
    const res = await fetch("/api/terms");
    if (res.ok) {
      const data = await res.json();
      if (data.ok) {
        termMeta = {
          currentTerm: data.current_term || "term1",
          currentSession: data.current_session || "2025/2026",
          termsList: data.terms || [],
        };
        return termMeta;
      }
    }
  } catch (e) {
    console.warn("Failed to fetch /api/terms:", e);
  }
  return termMeta;
}

function isTermEditable(termCode) {
  const t = termMeta.termsList.find((item) => item.term === termCode);
  if (t) return Boolean(t.allow_edit);
  return termCode === termMeta.currentTerm;
}

function populateTermSelect() {
  if (!termSelect) return;
  const currentVal = termSelect.value;
  termSelect.innerHTML = "";
  const terms =
    termMeta.termsList.length > 0
      ? termMeta.termsList
      : [
          { term: "term1", label: "1st Term", is_current: termMeta.currentTerm === "term1", allow_edit: true },
          { term: "term2", label: "2nd Term", is_current: termMeta.currentTerm === "term2", allow_edit: false },
          { term: "term3", label: "3rd Term", is_current: termMeta.currentTerm === "term3", allow_edit: false },
        ];

  terms.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.term;
    let suffix = "";
    if (t.is_current) suffix = " (Current)";
    else if (t.allow_edit) suffix = " (Unlocked)";
    else suffix = " (Locked)";
    opt.textContent = `${t.label}${suffix}`;
    termSelect.appendChild(opt);
  });

  if (currentVal && terms.some((t) => t.term === currentVal)) {
    termSelect.value = currentVal;
  } else {
    termSelect.value = termMeta.currentTerm;
  }
}

function updateTermLockUI(term) {
  const editable = isTermEditable(term);
  const isCurrent = term === termMeta.currentTerm;

  // 1. Inputs enabled/disabled
  document.querySelectorAll(".score-input").forEach((inp) => {
    inp.disabled = !editable;
  });

  // 2. Buttons
  if (btnSaveDraft) {
    btnSaveDraft.disabled = !editable || gridHasInvalid;
    btnSaveDraft.textContent = editable ? "Save Draft" : "Locked (Read-Only)";
  }
  if (btnSubmit) {
    btnSubmit.disabled = !editable || gridHasInvalid;
    btnSubmit.title = editable
      ? "Submit completed scores to administration for approval"
      : "Score editing is locked for this term";
  }

  // 3. Banner
  if (termLockBanner) {
    if (!editable) {
      termLockBanner.className =
        "bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs text-amber-900 flex items-center justify-between gap-3 shrink-0";
      if (termLockIcon) termLockIcon.textContent = "🔒";
      if (termLockText) {
        termLockText.innerHTML = `<strong>Viewing ${termLabel(term)} (Read-Only):</strong> Only the active school term can be edited. Administration permission is required to edit scores for this term.`;
      }
      if (termLockBadge) {
        termLockBadge.className =
          "px-2.5 py-0.5 bg-amber-200 text-amber-900 rounded font-semibold text-[10px] uppercase tracking-wide";
        termLockBadge.textContent = "Locked · Read-Only";
      }
      termLockBanner.classList.remove("hidden");
    } else if (!isCurrent) {
      termLockBanner.className =
        "bg-emerald-50 border-b border-emerald-200 px-4 py-2.5 text-xs text-emerald-900 flex items-center justify-between gap-3 shrink-0";
      if (termLockIcon) termLockIcon.textContent = "🔓";
      if (termLockText) {
        termLockText.innerHTML = `<strong>Admin Override Active:</strong> Score editing is unlocked for ${termLabel(term)}. Changes will save to ${termLabel(term)}.`;
      }
      if (termLockBadge) {
        termLockBadge.className =
          "px-2.5 py-0.5 bg-emerald-200 text-emerald-900 rounded font-semibold text-[10px] uppercase tracking-wide";
        termLockBadge.textContent = "Admin Edit Permitted";
      }
      termLockBanner.classList.remove("hidden");
    } else {
      termLockBanner.classList.add("hidden");
    }
  }
}

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

function gradeBadge(grade) {
  const g = String(grade || "").trim().toUpperCase();
  const cls = { A: "grade-a", B: "grade-b", C: "grade-c", D: "grade-d", E: "grade-e", F: "grade-f" }[g] || "grade-f";
  return `<span class="grade-badge ${cls}">${g || "—"}</span>`;
}

function statusBadge(status) {
  const s = String(status || "draft").toLowerCase();
  const styles = {
    draft: "bg-slate-100 text-slate-600 ring-slate-200",
    submitted: "bg-blue-50 text-blue-800 ring-blue-200",
    approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    published: "bg-purple-50 text-purple-800 ring-purple-200",
    returned: "bg-rose-50 text-rose-800 ring-rose-200",
  };
  const labels = {
    draft: "Draft",
    submitted: "Submitted",
    approved: "Approved",
    published: "Published",
    returned: "Returned",
  };
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

function defaultStatusMessage(panels) {
  return panels.length
    ? "Ready. Blanks are ignored; type 0 for zero."
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

  const className = classSelect?.value || "";
  const isSenior = className.toUpperCase().includes("SS") && !className.toUpperCase().includes("JSS");

  // Calculate Checkpoints
  const pr1 = calculatePR1(raw, isSenior);
  const pr2 = calculatePR2(raw, isSenior);
  const pr3 = calculatePR3(raw, isSenior);
  const tr = calculateTR(raw, { isSenior });
  const stored = toStoredScores(tr);

  // Desktop Elements
  const elPr1 = panel.querySelector('[data-out="pr1"]');
  if (elPr1) elPr1.textContent = pr1.hasData ? `${pr1.percentage}% (${pr1.grade})` : "—";

  const elPr2 = panel.querySelector('[data-out="pr2"]');
  if (elPr2) elPr2.textContent = pr2.hasData ? `${pr2.percentage}% (${pr2.grade})` : "—";

  const elPr3 = panel.querySelector('[data-out="pr3"]');
  if (elPr3) elPr3.textContent = pr3.hasData ? `${pr3.percentage}% (${pr3.grade})` : "—";

  const elCa = panel.querySelector('[data-out="ca"]');
  if (elCa) elCa.textContent = String(Math.round(tr.caTotal));

  const elTot = panel.querySelector('[data-out="total"]');
  if (elTot) elTot.textContent = String(stored.total);

  const elGr = panel.querySelector('[data-out="grade"]');
  if (elGr) elGr.innerHTML = gradeBadge(stored.grade);

  panel.dataset.invalid = validation.valid ? "0" : "1";
  return validation.valid;
}

function refreshGridValidationState(options = {}) {
  const panels = getSavePanels();
  panels.forEach((panel) => recalcPanel(panel));

  gridHasInvalid = panels.some((p) => p.dataset.invalid === "1");
  const canSave = !gridHasInvalid && panels.length > 0;

  if (btnSaveDraft) btnSaveDraft.disabled = !canSave;
  if (btnSubmit) btnSubmit.disabled = !canSave;

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
    current.endsWith("Submit failed.")
  ) {
    saveStatus.textContent = defaultStatusMessage(panels);
  }
}

function scoreFieldCell(name, value, max, colClass = "") {
  return `<td class="score-cell score-cell--input ${colClass}">${scoreInput(name, value, max)}</td>`;
}

function buildRow(student, existing, rowIndex) {
  const tr = document.createElement("tr");
  tr.className = "hover:bg-slate-50/50";
  tr.dataset.studentId = student.id;
  tr.dataset.resultId = existing?.id ?? "";
  tr.dataset.status = existing?.status ?? "draft";
  tr.dataset.returnReason = existing?.return_reason ?? "";

  const raw = normalizeBreakdown(existing);
  const status = tr.dataset.status;

  const cwTds = raw.cw
    .map((v, i) => scoreFieldCell(`cw${i + 1}`, v, GRADING_CONFIG.cw.itemMax, `col-cw-${i + 1}`))
    .join("");
  const hwTds = raw.hw
    .map((v, i) => scoreFieldCell(`hw${i + 1}`, v, GRADING_CONFIG.hw.itemMax, `col-hw-${i + 1}`))
    .join("");
  const testTds = raw.tests
    .map((v, i) => scoreFieldCell(`test${i + 1}`, v, GRADING_CONFIG.tests.maxes[i], `col-test-${i + 1}`))
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
    <td class="score-cell score-cell--input border-l border-slate-200 col-final-prj">${scoreInput("project", raw.project, GRADING_CONFIG.project.max)}</td>
    <td class="score-cell score-cell--input col-final-exm">${scoreInput("exam", raw.exam, GRADING_CONFIG.exam.max)}</td>
    
    <td class="score-cell score-cell--computed border-l border-slate-200 col-pr1" data-out="pr1">—</td>
    <td class="score-cell score-cell--computed col-pr2" data-out="pr2">—</td>
    <td class="score-cell score-cell--computed col-pr3" data-out="pr3">—</td>
    
    <td class="score-cell score-cell--computed border-l border-slate-200 col-tr-ca" data-out="ca">—</td>
    <td class="score-cell score-cell--total col-tr-tot" data-out="total">—</td>
    <td class="score-cell score-cell--grade col-tr-grd" data-out="grade">—</td>
    <td class="score-cell score-cell--status col-status" data-out="status">${statusBadge(status)}</td>
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
  const status = card.dataset.status;

  const cwFields = raw.cw
    .map((v, i) => mobileFieldGroup(`Wk ${i + 1}`, `cw${i + 1}`, v, GRADING_CONFIG.cw.itemMax))
    .join("");
  const hwFields = raw.hw
    .map((v, i) => mobileFieldGroup(`Wk ${i + 1}`, `hw${i + 1}`, v, GRADING_CONFIG.hw.itemMax))
    .join("");
  const testFields = raw.tests
    .map((v, i) => mobileFieldGroup(`Test ${i + 1} (/${GRADING_CONFIG.tests.maxes[i]})`, `test${i + 1}`, v, GRADING_CONFIG.tests.maxes[i]))
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
      <div class="score-card__section-title">Class Work (Weeks 1–10, each /10)</div>
      <div class="score-card__grid">${cwFields}</div>
    </div>
    <div class="score-card__section">
      <div class="score-card__section-title">Home Work / Assignment (Weeks 1–10, each /10)</div>
      <div class="score-card__grid">${hwFields}</div>
    </div>
    <div class="score-card__section">
      <div class="score-card__section-title">Regular Tests (T1 /15, T2 /15, T3 /30)</div>
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
      <div class="score-card__stat">Total<strong data-out="total">—</strong></div>
      <div class="score-card__stat">CA<strong data-out="ca">—</strong></div>
      <div class="score-card__stat">Grade<strong data-out="grade">—</strong></div>
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
    "id, student_id, subject_id, term, cw, hw, test, project, exam, total, grade, status, return_reason, score_breakdown";
  let { data, error } = await supabase
    .from("results")
    .select(selectCols)
    .eq("subject_id", subjectId)
    .eq("term", term)
    .in("student_id", studentIds);

  if (error && /return_reason/i.test(error.message || "")) {
    selectCols = "id, student_id, subject_id, term, cw, hw, test, project, exam, total, grade, status, score_breakdown";
    ({ data, error } = await supabase
      .from("results")
      .select(selectCols)
      .eq("subject_id", subjectId)
      .eq("term", term)
      .in("student_id", studentIds));
  }

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

  // Check for any returned results
  const returnedRecord = results.find((r) => r.status === "returned" && r.return_reason);
  if (returnedRecord && returnReasonBanner) {
    returnReasonText.textContent = returnedRecord.return_reason || "Admin requested corrections on this subject.";
    returnReasonBanner.classList.remove("hidden");
  } else if (returnReasonBanner) {
    returnReasonBanner.classList.add("hidden");
  }

  scoreTableBody.innerHTML = "";
  if (scoreCardsMobile) scoreCardsMobile.innerHTML = "";

  students.forEach((s, i) => {
    const existing = resultsByStudent.get(s.id);
    const idx = i + 1;
    scoreTableBody.appendChild(buildRow(s, existing, idx));
    if (scoreCardsMobile) scoreCardsMobile.appendChild(buildMobileCard(s, existing, idx));
  });

  applyColumnVisibility(currentView);
  updateTermLockUI(term);

  refreshGridValidationState({
    message: statusMessage ?? (isTermEditable(term) ? "Loaded. Blanks are ignored; type 0 for zero." : "Term scores are locked (Read-Only)."),
  });
}

function applyColumnVisibility(viewMode) {
  currentView = viewMode;
  document.querySelectorAll(".view-tab").forEach((tab) => {
    if (tab.dataset.view === viewMode) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  const table = document.querySelector(".score-table");
  if (!table) return;

  const cwGroup = table.querySelector(".col-cw-group");
  const hwGroup = table.querySelector(".col-hw-group");
  const testGroup = table.querySelector(".col-test-group");

  // Reset all
  table.querySelectorAll("[class*='col-']").forEach((el) => el.classList.remove("col-hidden"));

  if (viewMode === "pr1") {
    // Hide weeks 5-10 of CW & HW, Tests 2-3, Project, Exam
    table.querySelectorAll(".col-cw-5, .col-cw-6, .col-cw-7, .col-cw-8, .col-cw-9, .col-cw-10").forEach((el) => el.classList.add("col-hidden"));
    table.querySelectorAll(".col-hw-5, .col-hw-6, .col-hw-7, .col-hw-8, .col-hw-9, .col-hw-10").forEach((el) => el.classList.add("col-hidden"));
    table.querySelectorAll(".col-test-2, .col-test-3, .col-final-prj, .col-final-exm").forEach((el) => el.classList.add("col-hidden"));
    if (cwGroup) cwGroup.colSpan = 4;
    if (hwGroup) hwGroup.colSpan = 4;
    if (testGroup) testGroup.colSpan = 1;
  } else if (viewMode === "pr2") {
    // Hide weeks 8-10 of CW & HW, Test 3, Project, Exam
    table.querySelectorAll(".col-cw-8, .col-cw-9, .col-cw-10").forEach((el) => el.classList.add("col-hidden"));
    table.querySelectorAll(".col-hw-8, .col-hw-9, .col-hw-10").forEach((el) => el.classList.add("col-hidden"));
    table.querySelectorAll(".col-test-3, .col-final-prj, .col-final-exm").forEach((el) => el.classList.add("col-hidden"));
    if (cwGroup) cwGroup.colSpan = 7;
    if (hwGroup) hwGroup.colSpan = 7;
    if (testGroup) testGroup.colSpan = 2;
  } else if (viewMode === "pr3") {
    table.querySelectorAll(".col-final-prj, .col-final-exm").forEach((el) => el.classList.add("col-hidden"));
    if (cwGroup) cwGroup.colSpan = 10;
    if (hwGroup) hwGroup.colSpan = 10;
    if (testGroup) testGroup.colSpan = 3;
  } else if (viewMode === "tr") {
    table.querySelectorAll(".col-pr1, .col-pr2, .col-pr3").forEach((el) => el.classList.add("col-hidden"));
    if (cwGroup) cwGroup.colSpan = 10;
    if (hwGroup) hwGroup.colSpan = 10;
    if (testGroup) testGroup.colSpan = 3;
  } else {
    // all
    if (cwGroup) cwGroup.colSpan = 10;
    if (hwGroup) hwGroup.colSpan = 10;
    if (testGroup) testGroup.colSpan = 3;
  }
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
  const term = termSelect ? termSelect.value : (settings?.current_term ?? "term1");
  const className = classSelect.value;
  const subjectId = subjectSelect.value;
  if (!className || !subjectId) return;

  if (!isTermEditable(term)) {
    throw new Error(`Editing scores for ${termLabel(term)} is locked by administration.`);
  }

  saveStatus.textContent = status === "submitted" ? "Submitting to Admin..." : "Saving draft...";
  saveStatus.classList.remove("text-red-600");

  const currentSession = settings?.current_session || "2025/2026";
  const cls = await getClassByName(className);
  const now = new Date().toISOString();

  const payload = panels.map((panel) => {
    const raw = readRawScoresFromPanel(panel);
    const result = calculateStudentResult(raw, undefined, { className });
    const stored = toStoredScores(result);

    const record = {
      student_id: panel.dataset.studentId,
      subject_id: subjectId,
      class_id: cls?.id || null,
      session: currentSession,
      term,
      status,
      score_breakdown: raw,
      cw: stored.cw,
      hw: stored.hw,
      test: stored.test,
      project: stored.project,
      exam: stored.exam,
      total: stored.total,
      grade: stored.grade,
      updated_at: now,
      submitted_by: teacherAuthId || null,
    };

    if (status === "submitted") {
      record.submitted_at = now;
      // Clear previous return reason if re-submitting
      record.return_reason = null;
    }

    return record;
  });

  // 1. Try secure backend API first (uses service role, immune to client RLS restrictions)
  let savedViaApi = false;
  try {
    const res = await fetch("/api/results/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: payload, status, teacherAuthId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok) savedViaApi = true;
    }
  } catch (apiErr) {
    console.warn("Backend save API fallback to direct Supabase:", apiErr);
  }

  // 2. Fallback to direct client-side Supabase if server API is unavailable
  if (!savedViaApi) {
    let { error } = await supabase.from("results").upsert(payload, { onConflict: "student_id,subject_id,term,session" });
    if (error && /submitted_at|return_reason/i.test(error.message || "")) {
      const cleanedPayload = payload.map(({ submitted_at, return_reason, ...rest }) => rest);
      ({ error } = await supabase.from("results").upsert(cleanedPayload, { onConflict: "student_id,subject_id,term,session" }));
    }
    if (error && /session|score_breakdown/i.test(error.message || "")) {
      const fallbackPayload = payload.map(({ session, class_id, score_breakdown, submitted_at, return_reason, ...rest }) => rest);
      ({ error } = await supabase.from("results").upsert(fallbackPayload, { onConflict: "student_id,subject_id,term" }));
    }
    if (error) throw error;
  }

  const msg =
    status === "submitted"
      ? "✓ Submitted to Admin for approval. Results will be locked until approved."
      : "✓ Draft saved.";
  await renderGrid({ className, subjectId, term, statusMessage: msg });
}

export async function startResultsEntry() {
  const ok = await requireRole("teacher", { redirectTo: "/" });
  if (!ok) return;

  await loadTermsMetadata();
  populateTermSelect();

  const settings = await getAppSettings();
  const activeTerm = termSelect?.value || settings?.current_term || "term1";

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

  termSelect?.addEventListener("change", async () => {
    await renderGrid({
      className: classSelect.value,
      subjectId: subjectSelect.value,
      term: termSelect.value,
    });
  });

  classSelect.addEventListener("change", async () => {
    populateSubjectSelect(assignments, classSelect.value);
    await renderGrid({ className: classSelect.value, subjectId: subjectSelect.value, term: termSelect?.value || activeTerm });
  });

  subjectSelect.addEventListener("change", async () => {
    await renderGrid({ className: classSelect.value, subjectId: subjectSelect.value, term: termSelect?.value || activeTerm });
  });

  // View tab switcher
  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      applyColumnVisibility(tab.dataset.view);
    });
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
    if (btnSubmit) btnSubmit.disabled = true;
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

  btnSubmit?.addEventListener("click", async () => {
    if (gridHasInvalid) return;
    const confirmSubmit = confirm("Submit these scores to Admin for approval?\n\nOnce submitted, scores are queued for administrator sign-off.");
    if (!confirmSubmit) return;

    btnSaveDraft.disabled = true;
    btnSubmit.disabled = true;
    try {
      await saveAll({ teacherAuthId: ok.session.user.id, status: "submitted" });
    } catch (error) {
      alert(error?.message || "Failed to submit.");
      saveStatus.textContent = error?.message || "Submit failed.";
      saveStatus.classList.add("text-red-600");
    } finally {
      refreshGridValidationState({ skipMessage: true });
    }
  });

  await renderGrid({ className: classSelect.value, subjectId: subjectSelect.value, term });
}
