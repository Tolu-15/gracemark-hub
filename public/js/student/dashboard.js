import { requireRole } from "/js/shared/guard.js";
import { signOut } from "/js/shared/auth.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getLatestAppSettings } from "/js/shared/appSettings.js";
import { getStudentCurrentInvoice, formatCurrency } from "/js/shared/schoolFinance.js";
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
    const sessionList = ["2027/2028", "2026/2027", "2025/2026", "2024/2025"];
    if (session && !sessionList.includes(session)) sessionList.unshift(session);

    sessionSelect.innerHTML = sessionList
      .map((s) => `<option value="${s}" ${s === session ? "selected" : ""}>${s}</option>`)
      .join("");
    sessionSelect.disabled = false;
  }
}

async function loadStudentProfile(authId) {
  let { data, error } = await supabase
    .from("students")
    .select("id, admission_no, name, class_id, classes(name)")
    .eq("user_id", authId)
    .maybeSingle();

  if (error) console.warn("Student lookup notice:", error.message);

  if (!data) {
    // Auto-create missing student profile record
    const { data: { user } } = await supabase.auth.getUser();
    const displayName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "Student";
    const admissionNo = "GMA" + Math.floor(100000 + Math.random() * 900000);

    // Fetch existing class or auto-create a default class if empty
    let { data: defaultClass } = await supabase.from("classes").select("id").limit(1).maybeSingle();

    if (!defaultClass) {
      const { data: school } = await supabase.from("schools").select("id").limit(1).maybeSingle();
      if (school?.id) {
        const { data: createdClass } = await supabase
          .from("classes")
          .insert([{ name: "General Admission", school_id: school.id, session: "2026/2027" }])
          .select("id")
          .maybeSingle();
        defaultClass = createdClass;
      }
    }

    if (defaultClass?.id) {
      const { data: newStudent } = await supabase
        .from("students")
        .upsert(
          [
            {
              user_id: authId,
              class_id: defaultClass.id,
              admission_no: admissionNo,
              name: displayName,
            },
          ],
          { onConflict: "user_id" }
        )
        .select("id, admission_no, name, class_id, classes(name)")
        .maybeSingle();

      data = newStudent;
    }
  }

  if (!data) throw new Error("Unable to initialize student profile. Please contact administration.");

  currentStudent = data;
  studentName.textContent = data.name || "Student";
  if (displayAdmNo) displayAdmNo.textContent = data.admission_no || "—";
  if (displayClass) displayClass.textContent = data.classes?.name || "Unassigned";

  // Fetch Fee Summary
  try {
    const fin = await getStudentCurrentInvoice(data.id);
    const dashFeeBalance = document.getElementById("dashFeeBalance");
    const dashFeeStatusBadge = document.getElementById("dashFeeStatusBadge");

    if (fin) {
      if (dashFeeBalance) dashFeeBalance.textContent = formatCurrency(fin.outstandingBalance);
      if (dashFeeStatusBadge) {
        dashFeeStatusBadge.textContent = fin.status;
        if (fin.status === "FULLY PAID") {
          dashFeeStatusBadge.className = "px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500 text-slate-950 uppercase";
        } else if (fin.status === "PARTIALLY PAID") {
          dashFeeStatusBadge.className = "px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-400 text-slate-950 uppercase";
        } else {
          dashFeeStatusBadge.className = "px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-500 text-white uppercase";
        }
      }
    }
  } catch (finErr) {
    console.warn("Dashboard fee summary fetch:", finErr);
  }
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
      <button type="button" class="view-result-btn w-full py-2 text-sm font-semibold rounded-lg bg-violet-600 text-white shadow-md hover:bg-violet-700 transition-all">
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
  const selectedSession = sessionSelect?.value || latestSettings?.current_session || "";
  renderResultsEmpty("Loading approved results…");

  let baseQuery = supabase
    .from("results")
    .select(
      "id, subject_id, cw, hw, test, project, exam, total, grade, term, status, score_breakdown, subjects(name)"
    )
    .eq("student_id", currentStudent.id)
    .eq("term", term)
    .eq("status", "approved");

  if (selectedSession) {
    baseQuery = baseQuery.eq("session", selectedSession);
  }

  let { data, error } = await baseQuery;

  if (error && /score_breakdown/i.test(error.message || "")) {
    let fallbackQuery = supabase
      .from("results")
      .select("id, subject_id, cw, hw, test, project, exam, total, grade, term, status, subjects(name)")
      .eq("student_id", currentStudent.id)
      .eq("term", term)
      .eq("status", "approved");
    if (selectedSession) fallbackQuery = fallbackQuery.eq("session", selectedSession);
    ({ data, error } = await fallbackQuery);
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

async function loadCbtSummary() {
  const upcomingCbtContainer = document.getElementById("upcomingCbtContainer");
  const recentAttemptsContainer = document.getElementById("recentAttemptsContainer");

  if (!upcomingCbtContainer || !recentAttemptsContainer || !currentStudent || !latestSettings) return;

  try {
    const currentTerm = latestSettings.current_term || "term1";
    const currentSession = latestSettings.current_session || "";

    // 1. Fetch upcoming assessments
    const { data: upcoming, error: upErr } = await supabase
      .from("assessments")
      .select("id, title, assessment_type, start_date, end_date, duration, total_marks, subjects(name)")
      .eq("class_id", currentStudent.class_id)
      .eq("status", "published")
      .eq("session", currentSession)
      .eq("term", currentTerm)
      .order("created_at", { ascending: false });

    if (upErr) throw upErr;

    // Fetch student's submissions for these assessments to filter out already attempted ones
    const assessmentIds = (upcoming || []).map(a => a.id);
    let attemptedIds = new Set();
    if (assessmentIds.length) {
      const { data: subs } = await supabase
        .from("assessment_submissions")
        .select("assessment_id")
        .in("assessment_id", assessmentIds)
        .eq("student_id", currentStudent.id);
      attemptedIds = new Set((subs || []).map(s => s.assessment_id));
    }

    const notAttempted = (upcoming || []).filter(a => !attemptedIds.has(a.id));

    if (!notAttempted.length) {
      upcomingCbtContainer.innerHTML = `<p class="text-sm text-slate-500 py-4 text-center">No upcoming CBT assessments.</p>`;
    } else {
      upcomingCbtContainer.innerHTML = notAttempted.map(a => `
        <div class="p-3 border border-slate-200 rounded-lg flex justify-between items-center bg-slate-50/60 hover:bg-slate-50 transition-colors">
          <div>
            <div class="text-sm font-semibold text-slate-900">${a.title}</div>
            <div class="text-xs text-slate-500 mt-0.5">${a.subjects?.name || "Subject"} · ${a.assessment_type} · ${a.duration} mins</div>
          </div>
          <a href="/student/assessments/" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors">
            Start
          </a>
        </div>
      `).join("");
    }

    // 2. Fetch recent attempts
    const { data: attempts, error: attErr } = await supabase
      .from("assessment_submissions")
      .select("id, total_score, percentage, status, created_at, assessments(title, total_marks, subjects(name))")
      .eq("student_id", currentStudent.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (attErr) throw attErr;

    if (!attempts?.length) {
      recentAttemptsContainer.innerHTML = `<p class="text-sm text-slate-500 py-4 text-center">No recent assessment attempts.</p>`;
    } else {
      recentAttemptsContainer.innerHTML = attempts.map(sub => {
        const a = sub.assessments || {};
        const scoreStr = sub.status === "graded" 
          ? `<strong>${sub.total_score}</strong> / ${a.total_marks || 0} (${sub.percentage}%)` 
          : `<span class="text-amber-600 font-semibold">Pending Grading</span>`;
        return `
          <div class="p-3 border border-slate-200 rounded-lg flex justify-between items-center bg-slate-50/60">
            <div>
              <div class="text-sm font-semibold text-slate-900">${a.title || "Assessment"}</div>
              <div class="text-xs text-slate-500 mt-0.5">${a.subjects?.name || "Subject"} · ${new Date(sub.created_at).toLocaleDateString()}</div>
            </div>
            <div class="text-xs text-slate-700 font-medium">
              ${scoreStr}
            </div>
          </div>
        `;
      }).join("");
    }
  } catch (error) {
    console.error("Load CBT summary error:", error);
  }
}

async function init() {
  try {
    const ok = await requireRole("student", { redirectTo: "/" });
    if (!ok) return;

    await Promise.all([loadStudentProfile(ok.session.user.id), loadLatestSettings()]);
    authLoader.style.display = "none";
    await Promise.all([refreshResults(), loadCbtSummary()]);
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
sessionSelect?.addEventListener("change", () => refreshResults());

closeModalBtn?.addEventListener("click", closeBreakdownModal);
breakdownModal?.addEventListener("click", (e) => {
  if (e.target === breakdownModal) closeBreakdownModal();
});

init();
