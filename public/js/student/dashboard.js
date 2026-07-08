import { requireRole } from "/js/shared/guard.js";
import { signOut } from "/js/shared/auth.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getLatestAppSettings } from "/js/shared/appSettings.js";
import { GRADING_CONFIG, normalizeBreakdown, calculateStudentResult } from "/shared/gradingEngine.js";
import { openResultDashboard } from "/js/student/resultDashboard/mount.js";

const authLoader = document.getElementById("authLoader");
const logoutBtn = document.getElementById("logoutBtn");
const studentName = document.getElementById("studentName");
const displaySession = document.getElementById("displaySession");
const displayAdmNo = document.getElementById("displayAdmNo");
const displayClass = document.getElementById("displayClass");
const termSelect = document.getElementById("termSelect");
const sessionSelect = document.getElementById("sessionSelect");
const viewResultsBtn = document.getElementById("viewResultsBtn");
const resultsContainer = document.getElementById("resultsContainer");
const resultsCountBadge = document.getElementById("resultsCountBadge");
const breakdownModal = document.getElementById("breakdownModal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const closeModalBtn = document.getElementById("closeModalBtn");
const resultDashboardOverlay = document.getElementById("resultDashboardOverlay");

let currentStudent = null;
let latestSettings = null;

const TERM_OPTIONS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

function termDbToLabel(term) {
  return TERM_OPTIONS.find((t) => t.value === term)?.label ?? "1st Term";
}

function applyLatestSessionToUi(settings) {
  const session = String(settings?.current_session || "").trim();
  const currentTerm = settings?.current_term || "term1";

  if (displaySession) {
    displaySession.textContent = session || "Not set yet";
  }

  if (termSelect) {
    termSelect.innerHTML = TERM_OPTIONS.map(
      (t) => `<option value="${t.value}">${t.label}</option>`
    ).join("");
    termSelect.value = TERM_OPTIONS.some((t) => t.value === currentTerm) ? currentTerm : "term1";
  }

  if (sessionSelect) {
    sessionSelect.innerHTML = "";
    if (session) {
      const option = document.createElement("option");
      option.value = session;
      option.textContent = session;
      option.selected = true;
      sessionSelect.appendChild(option);
    } else {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No session configured";
      sessionSelect.appendChild(option);
    }
    sessionSelect.disabled = true;
  }
}

async function loadStudentProfile(authId) {
  const { data, error } = await supabase
    .from("students")
    .select("id, admission_no, name, class_id, classes(name)")
    .eq("user_id", authId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Student record not found. Ask an administrator to add your profile.");

  currentStudent = data;
  studentName.textContent = data.name || "Student";
  if (displayAdmNo) displayAdmNo.textContent = data.admission_no || "—";
  if (displayClass) displayClass.textContent = data.classes?.name || "Unassigned";
}

async function loadLatestSettings() {
  latestSettings = await getLatestAppSettings();
  applyLatestSessionToUi(latestSettings);
}

function setResultsCount(count) {
  if (!resultsCountBadge) return;
  if (!count) {
    resultsCountBadge.textContent = "";
    resultsCountBadge.className = "hidden";
    return;
  }
  resultsCountBadge.textContent = `${count} subject${count === 1 ? "" : "s"}`;
  resultsCountBadge.className =
    "px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800";
}

function renderResultsEmpty(message) {
  if (!resultsContainer) return;
  setResultsCount(0);
  resultsContainer.innerHTML = `
    <div class="col-span-full p-8 text-center text-slate-500 bg-white border border-slate-200 rounded-xl shadow-sm">
      ${message}
    </div>
  `;
}

function renderResultCards(rows) {
  if (!resultsContainer) return;

  if (!rows.length) {
    const termLabel = termDbToLabel(termSelect?.value);
    renderResultsEmpty(
      `No approved results for <strong>${termLabel}</strong> yet.<br><span class="text-sm mt-2 block">Scores appear here only after your teacher publishes <em>and</em> the school admin approves them. If your teacher recently updated scores, admin must approve again.</span>`
    );
    return;
  }

  setResultsCount(rows.length);
  resultsContainer.innerHTML = "";
  rows.forEach((row) => {
    const card = document.createElement("article");
    card.className =
      "bg-white border border-slate-200 rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer";
    const subjectName = row.subjects?.name ?? row._subjectName ?? "Subject";
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3 mb-3">
        <h4 class="font-semibold text-slate-900">${subjectName}</h4>
        <span class="text-xs font-bold px-2 py-1 rounded bg-emerald-50 text-emerald-700">${row.grade ?? "—"}</span>
      </div>
      <p class="text-3xl font-bold text-slate-900 mb-3">${row.total ?? 0}<span class="text-base font-medium text-slate-500"> / 100</span></p>
      <button type="button" class="view-result-btn w-full py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md hover:from-violet-500 hover:to-indigo-500 transition-all">
        View Result
      </button>
    `;
    card.querySelector(".view-result-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openFullResultDashboard();
    });
    card.addEventListener("click", () => openFullResultDashboard());
    resultsContainer.appendChild(card);
  });
}

function breakdownSection(title, items) {
  if (!items.length) return "";
  return `
    <div class="mb-4">
      <h4 class="text-xs font-bold text-slate-500 uppercase mb-2">${title}</h4>
      <div class="flex flex-wrap gap-2">${items.join("")}</div>
    </div>
  `;
}

function rawChip(label, value, max) {
  const v = value === "" || value === null || value === undefined ? "—" : value;
  return `<span class="px-2 py-1 bg-slate-100 rounded text-sm"><span class="text-slate-500">${label}:</span> <strong>${v}</strong><span class="text-slate-400">/${max}</span></span>`;
}

function openBreakdownModal(subjectName, row) {
  if (!breakdownModal || !modalBody || !modalTitle) return;

  const raw = normalizeBreakdown(row);
  const computed = calculateStudentResult(raw);

  modalTitle.textContent = `${subjectName} — Score Breakdown`;
  modalBody.innerHTML = `
    ${breakdownSection(
      "Classwork (5 × 10 → /10)",
      raw.cw.map((v, i) => rawChip(`CW${i + 1}`, v, GRADING_CONFIG.cw.itemMax))
    )}
    ${breakdownSection(
      "Assignments (5 × 10 → /5)",
      raw.hw.map((v, i) => rawChip(`Asg${i + 1}`, v, GRADING_CONFIG.hw.itemMax))
    )}
    ${breakdownSection(
      "Tests (15 + 15 + 30 → /10)",
      raw.tests.map((v, i) => rawChip(`T${i + 1}`, v, GRADING_CONFIG.tests.maxes[i]))
    )}
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      ${scoreCell("CW /10", Math.round(computed.scaled.cw))}
      ${scoreCell("Asg /5", Math.round(computed.scaled.hw))}
      ${scoreCell("Tests /10", Math.round(computed.scaled.tests))}
      ${scoreCell("Project /5", Math.round(computed.scaled.project))}
      ${scoreCell("Exam /70", row.exam ?? Math.round(computed.scaled.exam))}
    </div>
    <div class="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200 mt-4">
      <span class="font-medium text-slate-700">Total /100</span>
      <span class="text-xl font-bold text-slate-900">${row.total ?? Math.round(computed.totalScore)} (${row.grade ?? computed.grade})</span>
    </div>
  `;

  breakdownModal.classList.remove("hidden");
  requestAnimationFrame(() => {
    breakdownModal.classList.remove("opacity-0");
    breakdownModal.querySelector("div")?.classList.remove("scale-95");
  });
}

function scoreCell(label, value) {
  return `
    <div class="text-center p-4 bg-white border border-slate-200 rounded-lg">
      <div class="text-xs font-semibold text-slate-500 uppercase mb-1">${label}</div>
      <div class="text-2xl font-bold text-slate-900">${value ?? 0}</div>
    </div>
  `;
}

function closeBreakdownModal() {
  if (!breakdownModal) return;
  breakdownModal.classList.add("opacity-0");
  setTimeout(() => breakdownModal.classList.add("hidden"), 200);
}

async function fetchSubjectNames(subjectIds) {
  const ids = [...new Set(subjectIds.filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await supabase.from("subjects").select("id, name").in("id", ids);
  if (error) {
    console.warn("Could not load subject names:", error.message);
    return new Map();
  }
  return new Map((data ?? []).map((s) => [s.id, s.name]));
}

async function loadApprovedResults() {
  if (!currentStudent?.id) return;

  const term = termSelect?.value || latestSettings?.current_term || "term1";
  renderResultsEmpty("Loading approved results…");

  const baseQuery = () =>
    supabase
      .from("results")
      .select(
        "id, subject_id, cw, hw, test, project, exam, total, grade, term, status, score_breakdown, subjects(name)"
      )
      .eq("student_id", currentStudent.id)
      .eq("term", term)
      .eq("status", "approved");

  let { data, error } = await baseQuery();

  if (error && /score_breakdown/i.test(error.message || "")) {
    ({ data, error } = await supabase
      .from("results")
      .select("id, subject_id, cw, hw, test, project, exam, total, grade, term, status, subjects(name)")
      .eq("student_id", currentStudent.id)
      .eq("term", term)
      .eq("status", "approved"));
  }

  if (error) throw error;

  let rows = data ?? [];

  const needsSubjectLookup = rows.some((r) => !r.subjects?.name && r.subject_id);
  if (needsSubjectLookup) {
    const nameMap = await fetchSubjectNames(rows.map((r) => r.subject_id));
    rows = rows.map((r) => ({
      ...r,
      _subjectName: r.subjects?.name ?? nameMap.get(r.subject_id) ?? "Subject",
    }));
  }

  rows.sort((a, b) => {
    const nameA = a.subjects?.name ?? a._subjectName ?? "";
    const nameB = b.subjects?.name ?? b._subjectName ?? "";
    return nameA.localeCompare(nameB);
  });

  renderResultCards(rows);
}

function refreshResults() {
  return loadApprovedResults().catch((error) => {
    console.error("Load results error:", error);
    renderResultsEmpty(error?.message || "Failed to load results.");
  });
}

async function init() {
  try {
    const ok = await requireRole("student", { redirectTo: "/" });
    if (!ok) return;

    await Promise.all([loadStudentProfile(ok.session.user.id), loadLatestSettings()]);
    authLoader.style.display = "none";
    await refreshResults();
  } catch (error) {
    console.error("Student init error:", error);
    authLoader.innerHTML = `
      <p class="text-sm font-medium text-slate-800 mb-2 text-center">${error?.message || "Cannot connect to the database."}</p>
      <button onclick="window.location.replace('/')" class="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm">
        Return to Login
      </button>
    `;
  }
}

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut();
  } finally {
    window.location.replace("/");
  }
});

function openFullResultDashboard() {
  if (!currentStudent || !resultDashboardOverlay) return;
  const term = termSelect?.value || latestSettings?.current_term || "term1";
  const session =
    sessionSelect?.value ||
    latestSettings?.current_session ||
    displaySession?.textContent ||
    "";
  openResultDashboard({
    container: resultDashboardOverlay,
    student: currentStudent,
    term,
    session: session === "Not set yet" ? "" : session,
  });
  resultDashboardOverlay.setAttribute("aria-hidden", "false");
}

viewResultsBtn?.addEventListener("click", () => openFullResultDashboard());
termSelect?.addEventListener("change", () => refreshResults());

closeModalBtn?.addEventListener("click", closeBreakdownModal);
breakdownModal?.addEventListener("click", (e) => {
  if (e.target === breakdownModal) closeBreakdownModal();
});

init();
