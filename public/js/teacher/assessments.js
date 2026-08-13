import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings } from "/js/shared/appSettings.js";
import {
  calculateStudentResult,
  emptyRawScores,
  normalizeBreakdown,
  toStoredScores
} from "/shared/gradingEngine.js";

// DOM references
const authLoader = document.getElementById("authLoader");
const logoutBtn = document.getElementById("logoutBtn");

// Navigation buttons
const btnCreateAssessment = document.getElementById("btnCreateAssessment");
const btnUploadScores = document.getElementById("btnUploadScores");
const btnCancelEditor = document.getElementById("btnCancelEditor");
const btnCancelSubmissions = document.getElementById("btnCancelSubmissions");
const btnCancelUploader = document.getElementById("btnCancelUploader");

// Views
const dashboardView = document.getElementById("dashboardView");
const editorView = document.getElementById("editorView");
const submissionsView = document.getElementById("submissionsView");
const scoreUploaderView = document.getElementById("scoreUploaderView");

// Dashboard filters & grid
const filterAll = document.getElementById("filterAll");
const filterDraft = document.getElementById("filterDraft");
const filterPublished = document.getElementById("filterPublished");
const filterArchived = document.getElementById("filterArchived");
const classFilter = document.getElementById("classFilter");
const subjectFilter = document.getElementById("subjectFilter");
const assessmentsGrid = document.getElementById("assessmentsGrid");

// Assessment Form Elements
const editorTitle = document.getElementById("editorTitle");
const assessmentForm = document.getElementById("assessmentForm");
const formTitle = document.getElementById("formTitle");
const formDesc = document.getElementById("formDesc");
const formClass = document.getElementById("formClass");
const formSubject = document.getElementById("formSubject");
const formSession = document.getElementById("formSession");
const formTerm = document.getElementById("formTerm");
const formType = document.getElementById("formType");
const formDurationSelect = document.getElementById("formDurationSelect");
const formDuration = document.getElementById("formDuration");
const formTotalMarks = document.getElementById("formTotalMarks");
const formPassMark = document.getElementById("formPassMark");
const formStartDate = document.getElementById("formStartDate");
const formEndDate = document.getElementById("formEndDate");
const formInstructions = document.getElementById("formInstructions");
const formAllowResult = document.getElementById("formAllowResult");
const questionsContainer = document.getElementById("questionsContainer");
const btnAddQuestion = document.getElementById("btnAddQuestion");
const btnSaveDraftForm = document.getElementById("btnSaveDraftForm");
const btnPublishForm = document.getElementById("btnPublishForm");

// Submissions Table
const submissionsTitle = document.getElementById("submissionsTitle");
const submissionsSubtitle = document.getElementById("submissionsSubtitle");
const submissionsTableBody = document.getElementById("submissionsTableBody");

// Manual Grading Modal
const gradingModal = document.getElementById("gradingModal");
const gradingModalTitle = document.getElementById("gradingModalTitle");
const gradingModalStudent = document.getElementById("gradingModalStudent");
const gradingModalBody = document.getElementById("gradingModalBody");
const gradingModalTotalScore = document.getElementById("gradingModalTotalScore");
const gradingModalMaxScore = document.getElementById("gradingModalMaxScore");
const btnSubmitGrades = document.getElementById("btnSubmitGrades");
const closeGradingModalBtn = document.getElementById("closeGradingModalBtn");

// Score Uploader elements
const uploadClass = document.getElementById("uploadClass");
const uploadSubject = document.getElementById("uploadSubject");
const uploadAssessment = document.getElementById("uploadAssessment");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileDetails = document.getElementById("fileDetails");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const btnRemoveFile = document.getElementById("btnRemoveFile");
const uploadPreviewSection = document.getElementById("uploadPreviewSection");
const uploadPreviewBody = document.getElementById("uploadPreviewBody");
const validationSummary = document.getElementById("validationSummary");
const btnSaveUploadedScores = document.getElementById("btnSaveUploadedScores");

// State management
let currentUser = null;
let teacherProfile = null;
let appSettings = null;
let teacherAssignments = [];
let assessmentsList = [];
let activeFilters = { status: "all", classId: "", subjectId: "" };

let currentEditingAssessmentId = null; // null for creating new
let questionsList = []; // Array of { id, question, question_type, options, correct_answer, explanation, marks, position }

let activeGradingSubmission = null;
let activeGradingAnswers = [];

let parsedUploadRows = []; // parsed file rows

// Startup function
async function init() {
  try {
    const ok = await requireRole("teacher", { redirectTo: "/" });
    if (!ok) return;

    currentUser = ok.user;
    teacherProfile = ok.profile;

    // Load global school settings
    appSettings = await getAppSettings();
    
    // Fetch assignments mapped to teacher
    const { data: assignments, error: assignErr } = await supabase
      .from("teacher_assignments")
      .select("class_id, subject_id, classes(name), subjects(name)")
      .eq("teacher_user_id", currentUser.id);

    if (assignErr) throw assignErr;
    teacherAssignments = assignments || [];

    // Populate dashboard filters and form select inputs
    populateSelectDropdowns();

    // Fetch and render initial lists
    await refreshAssessmentsList();

    authLoader.style.display = "none";
  } catch (error) {
    console.error("Init Error:", error);
    alert("Failed to load assessments dashboard. " + error.message);
  }
}

// Helpers
function populateSelectDropdowns() {
  // Collect unique classes and subjects assigned
  const classes = [];
  const subjects = [];
  const classMap = new Map();
  const subjectMap = new Map();

  teacherAssignments.forEach((ta) => {
    if (ta.classes && !classMap.has(ta.class_id)) {
      classMap.set(ta.class_id, ta.classes.name);
      classes.push({ id: ta.class_id, name: ta.classes.name });
    }
    if (ta.subjects && !subjectMap.has(ta.subject_id)) {
      subjectMap.set(ta.subject_id, ta.subjects.name);
      subjects.push({ id: ta.subject_id, name: ta.subjects.name });
    }
  });

  // Sort lists alphabetically
  classes.sort((a, b) => a.name.localeCompare(b.name));
  subjects.sort((a, b) => a.name.localeCompare(b.name));

  // Populate main page dashboard filters
  classFilter.innerHTML = `<option value="">All Classes</option>` +
    classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  subjectFilter.innerHTML = `<option value="">All Subjects</option>` +
    subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join("");

  // Populate editor form selects
  formClass.innerHTML = classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  formSubject.innerHTML = subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join("");

  // Populate manual uploader selects
  uploadClass.innerHTML = classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  uploadSubject.innerHTML = subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join("");

  // Form readonly values
  formSession.value = appSettings?.current_session || "2025/2026";
  formTerm.value = appSettings?.current_term === "term1" ? "1st Term" : appSettings?.current_term === "term2" ? "2nd Term" : "3rd Term";
}

async function loadTeacherStats() {
  const statTotalAssessments = document.getElementById("statTotalAssessments");
  const statPendingGrading = document.getElementById("statPendingGrading");
  const statAvgScore = document.getElementById("statAvgScore");

  if (!statTotalAssessments || !statPendingGrading || !statAvgScore) return;

  statTotalAssessments.textContent = assessmentsList.length;

  const assessmentIds = assessmentsList.map(a => a.id);
  if (!assessmentIds.length) {
    statPendingGrading.textContent = "0";
    statAvgScore.textContent = "—";
    return;
  }

  try {
    // 1. Pending grading
    const { count: pendingCount, error: pErr } = await supabase
      .from("assessment_submissions")
      .select("id", { count: "exact", head: true })
      .in("assessment_id", assessmentIds)
      .eq("status", "submitted");

    if (pErr) throw pErr;
    statPendingGrading.textContent = pendingCount || 0;

    // 2. Average score
    const { data: gradedData, error: gErr } = await supabase
      .from("assessment_submissions")
      .select("percentage")
      .in("assessment_id", assessmentIds)
      .eq("status", "graded");

    if (gErr) throw gErr;
    if (gradedData && gradedData.length) {
      const sum = gradedData.reduce((s, d) => s + (Number(d.percentage) || 0), 0);
      statAvgScore.textContent = Math.round(sum / gradedData.length) + "%";
    } else {
      statAvgScore.textContent = "—";
    }
  } catch (error) {
    console.error("Load teacher stats error:", error);
  }
}

// Fetch assessments from database
async function refreshAssessmentsList() {
  try {
    const { data, error } = await supabase
      .from("assessments")
      .select("*, classes(name), subjects(name)")
      .eq("teacher_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    assessmentsList = data || [];
    renderAssessmentsDashboard();
    await loadTeacherStats();
  } catch (error) {
    console.error("Fetch assessments error:", error);
  }
}

// Render list view cards
function renderAssessmentsDashboard() {
  let filtered = [...assessmentsList];

  // Apply filters
  if (activeFilters.status !== "all") {
    filtered = filtered.filter(a => a.status === activeFilters.status);
  }
  if (activeFilters.classId) {
    filtered = filtered.filter(a => a.class_id === activeFilters.classId);
  }
  if (activeFilters.subjectId) {
    filtered = filtered.filter(a => a.subject_id === activeFilters.subjectId);
  }

  if (!filtered.length) {
    assessmentsGrid.innerHTML = `
      <div class="col-span-full p-12 text-center text-slate-500 bg-white border border-slate-200 rounded-xl shadow-sm">
        No assessments found matching the filters. Click "Create Assessment" to get started.
      </div>
    `;
    return;
  }

  // Fetch attempt counts for each assessment
  assessmentsGrid.innerHTML = "";
  filtered.forEach(async (a) => {
    // Get attempts count
    const { count } = await supabase
      .from("assessment_submissions")
      .select("*", { count: "exact", head: true })
      .eq("assessment_id", a.id);

    const card = document.createElement("article");
    card.className = "bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow";
    
    // Status Badge classes
    let statusClass = "bg-slate-100 text-slate-700";
    if (a.status === "published") statusClass = "bg-emerald-50 text-emerald-700 border border-emerald-100";
    else if (a.status === "archived") statusClass = "bg-rose-50 text-rose-700 border border-rose-100";

    card.innerHTML = `
      <div>
        <div class="flex justify-between items-start mb-3">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusClass}">${a.status.toUpperCase()}</span>
          <span class="text-xs text-slate-400 font-bold uppercase">${a.assessment_type}</span>
        </div>
        <h3 class="text-base font-bold text-slate-900 mb-1">${a.title}</h3>
        <p class="text-xs text-slate-500 mb-4 line-clamp-2">${a.description || "No description provided."}</p>
        
        <div class="grid grid-cols-2 gap-y-2 gap-x-4 border-t border-b border-slate-100 py-3 mb-4 text-xs">
          <div><span class="text-slate-400 font-medium">Class:</span> <strong class="text-slate-700">${a.classes?.name || "Unassigned"}</strong></div>
          <div><span class="text-slate-400 font-medium">Subject:</span> <strong class="text-slate-700">${a.subjects?.name || "Unassigned"}</strong></div>
          <div><span class="text-slate-400 font-medium">Duration:</span> <strong class="text-slate-700">${a.duration} mins</strong></div>
          <div><span class="text-slate-400 font-medium">Marks:</span> <strong class="text-slate-700">${a.total_marks} marks</strong></div>
        </div>
      </div>
      
      <div class="space-y-3">
        <div class="flex justify-between items-center text-xs text-slate-500">
          <span>Student Submissions:</span>
          <span class="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">${count || 0} attempt${count === 1 ? "" : "s"}</span>
        </div>
        
        <button type="button" class="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5 btn-view-submissions" data-id="${a.id}">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          View Submissions (${count || 0})
        </button>

        <div class="grid grid-cols-2 gap-2">
          <button class="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 btn-edit" data-id="${a.id}">
            Edit
          </button>
          <button class="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 btn-duplicate" data-id="${a.id}">
            Duplicate
          </button>
          <button class="px-3 py-1.5 border border-slate-200 hover:bg-rose-50 hover:text-rose-600 rounded-lg text-xs font-semibold text-slate-700 btn-delete" data-id="${a.id}">
            Delete
          </button>
          ${
            a.status === "draft"
              ? `<button class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 btn-status" data-id="${a.id}" data-action="published">Publish</button>`
              : a.status === "published"
              ? `<button class="px-3 py-1.5 bg-yellow-600 text-white rounded-lg text-xs font-semibold hover:bg-yellow-700 btn-status" data-id="${a.id}" data-action="draft">Unpublish</button>`
              : `<button class="px-3 py-1.5 bg-slate-600 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 btn-status" data-id="${a.id}" data-action="draft">Restore</button>`
          }
        </div>
      </div>
    `;

    // Attach listeners
    card.querySelector(".btn-view-submissions").addEventListener("click", () => openSubmissions(a.id, a.title));
    card.querySelector(".btn-edit").addEventListener("click", () => openEditor(a.id));
    card.querySelector(".btn-duplicate").addEventListener("click", () => duplicateAssessment(a.id));
    card.querySelector(".btn-delete").addEventListener("click", () => deleteAssessment(a.id));
    card.querySelector(".btn-status").addEventListener("click", (e) => {
      const action = e.target.dataset.action;
      updateAssessmentStatus(a.id, action);
    });

    assessmentsGrid.appendChild(card);
  });
}

// Navigation helpers
function switchView(view) {
  [dashboardView, editorView, submissionsView, scoreUploaderView].forEach(v => v.classList.add("hidden"));
  view.classList.remove("hidden");
}

// Active Filter state changes
function setFilterTab(tabBtn, statusVal) {
  [filterAll, filterDraft, filterPublished, filterArchived].forEach(btn => {
    btn.classList.remove("bg-white", "text-slate-800", "shadow-sm");
    btn.classList.add("text-slate-500");
  });
  tabBtn.classList.remove("text-slate-500");
  tabBtn.classList.add("bg-white", "text-slate-800", "shadow-sm");
  activeFilters.status = statusVal;
  renderAssessmentsDashboard();
}

filterAll.addEventListener("click", () => setFilterTab(filterAll, "all"));
filterDraft.addEventListener("click", () => setFilterTab(filterDraft, "draft"));
filterPublished.addEventListener("click", () => setFilterTab(filterPublished, "published"));
filterArchived.addEventListener("click", () => setFilterTab(filterArchived, "archived"));

classFilter.addEventListener("change", () => {
  activeFilters.classId = classFilter.value;
  renderAssessmentsDashboard();
});
subjectFilter.addEventListener("change", () => {
  activeFilters.subjectId = subjectFilter.value;
  renderAssessmentsDashboard();
});

// View toggles
btnCreateAssessment.addEventListener("click", () => openEditor(null));
btnCancelEditor.addEventListener("click", () => switchView(dashboardView));
btnCancelSubmissions.addEventListener("click", () => switchView(dashboardView));
btnCancelUploader.addEventListener("click", () => switchView(dashboardView));

formDurationSelect.addEventListener("change", () => {
  if (formDurationSelect.value === "custom") {
    formDuration.classList.remove("hidden");
    formDuration.value = "";
    formDuration.focus();
  } else {
    formDuration.classList.add("hidden");
    formDuration.value = formDurationSelect.value;
  }
});

// Editor dynamic functions
function openEditor(assessmentId) {
  currentEditingAssessmentId = assessmentId;
  assessmentForm.reset();
  questionsContainer.innerHTML = "";
  questionsList = [];

  if (assessmentId) {
    // Editing an existing assessment
    editorTitle.textContent = "Edit Assessment";
    const a = assessmentsList.find(x => x.id === assessmentId);
    if (!a) return;

    formTitle.value = a.title || "";
    formDesc.value = a.description || "";
    formClass.value = a.class_id || "";
    formSubject.value = a.subject_id || "";
    formType.value = a.assessment_type || "Test 1 (Week 3)";
    
    const standardIntervals = ["10", "15", "20", "30", "40", "45", "60", "90", "120", "180"];
    if (standardIntervals.includes(String(a.duration))) {
      formDurationSelect.value = String(a.duration);
      formDuration.value = String(a.duration);
      formDuration.classList.add("hidden");
    } else {
      formDurationSelect.value = "custom";
      formDuration.value = a.duration || "";
      formDuration.classList.remove("hidden");
    }
    
    formPassMark.value = a.pass_mark || "";
    formInstructions.value = a.instructions || "";
    formAllowResult.checked = a.allow_result_view;

    if (a.start_date) {
      formStartDate.value = new Date(a.start_date).toISOString().substring(0, 16);
    }
    if (a.end_date) {
      formEndDate.value = new Date(a.end_date).toISOString().substring(0, 16);
    }

    loadAssessmentQuestions(assessmentId);
  } else {
    // Creating new assessment
    editorTitle.textContent = "Create Assessment";
    formDurationSelect.value = "30";
    formDuration.value = "30";
    formDuration.classList.add("hidden");
    formPassMark.value = "10";
    formTotalMarks.value = "0";
    formAllowResult.checked = true;
    
    // Add one starting empty question
    addNewQuestionObject();
  }

  switchView(editorView);
}

async function loadAssessmentQuestions(assessmentId) {
  try {
    const { data, error } = await supabase
      .from("assessment_questions")
      .select("*")
      .eq("assessment_id", assessmentId)
      .order("position", { ascending: true });

    if (error) throw error;
    
    questionsList = data || [];
    renderQuestionsBuilder();
  } catch (error) {
    console.error("Load questions error:", error);
  }
}

// Add empty question model to list
function addNewQuestionObject() {
  const newQ = {
    id: "temp_" + Date.now() + "_" + Math.random(),
    question: "",
    question_type: "Multiple Choice",
    options: ["", "", "", ""],
    correct_answer: "0",
    explanation: "",
    marks: 5,
    position: questionsList.length
  };
  questionsList.push(newQ);
  renderQuestionsBuilder();
}

btnAddQuestion.addEventListener("click", addNewQuestionObject);

// Recompute total marks summation
function recomputeTotalMarks() {
  let total = 0;
  questionsList.forEach((q) => {
    total += Number(q.marks || 0);
  });
  formTotalMarks.value = total;
}

// Render dynamic forms for question creator
function renderQuestionsBuilder() {
  questionsContainer.innerHTML = "";
  recomputeTotalMarks();

  questionsList.forEach((q, idx) => {
    const div = document.createElement("div");
    div.className = "py-6 space-y-4 data-q-item";
    div.dataset.index = idx;

    // Build question skeleton
    div.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-4">
        <h4 class="font-bold text-slate-800">Question ${idx + 1}</h4>
        <div class="flex items-center gap-2">
          <button type="button" class="text-xs text-rose-500 font-semibold hover:underline btn-delete-q" data-idx="${idx}">Delete</button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="md:col-span-2 space-y-1">
          <label class="text-xs font-semibold text-slate-500">Question Text *</label>
          <input type="text" value="${q.question}" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm input-question" required placeholder="Type the question content here..." />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-semibold text-slate-500">Marks *</label>
          <input type="number" value="${q.marks}" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm input-marks" required min="1" />
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="space-y-1">
          <label class="text-xs font-semibold text-slate-500">Question Type</label>
          <select class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white select-q-type">
            <option value="Multiple Choice" ${q.question_type === "Multiple Choice" ? "selected" : ""}>Multiple Choice</option>
            <option value="True / False" ${q.question_type === "True / False" ? "selected" : ""}>True / False</option>
            <option value="Fill in the Blank" ${q.question_type === "Fill in the Blank" ? "selected" : ""}>Fill in the Blank</option>
            <option value="Short Answer" ${q.question_type === "Short Answer" ? "selected" : ""}>Short Answer</option>
            <option value="Essay" ${q.question_type === "Essay" ? "selected" : ""}>Essay</option>
          </select>
        </div>
        <div class="space-y-1 answers-container">
          <!-- Answer inputs render dynamically here based on selected type -->
        </div>
      </div>

      <div class="space-y-1">
        <label class="text-xs font-semibold text-slate-500">Explanation / Reference Rubric</label>
        <textarea rows="1" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm input-explanation" placeholder="Explanation for correct answer or grading rubric for subjective grading...">${q.explanation || ""}</textarea>
      </div>
    `;

    // Answers container targeting
    const ansContainer = div.querySelector(".answers-container");
    
    if (q.question_type === "Multiple Choice") {
      // MCQ: 4 text choices and 1 radio selector for index
      const options = q.options || ["", "", "", ""];
      ansContainer.innerHTML = `
        <label class="text-xs font-semibold text-slate-500 block mb-1">Options & Correct Answer *</label>
        <div class="space-y-2">
          ${options.map((opt, oIdx) => `
            <div class="flex items-center gap-2">
              <input type="radio" name="correct_${idx}" value="${oIdx}" ${String(q.correct_answer) === String(oIdx) ? "checked" : ""} class="radio-correct" />
              <input type="text" value="${opt}" class="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs input-opt" data-opt-idx="${oIdx}" required placeholder="Option ${oIdx + 1}" />
            </div>
          `).join("")}
        </div>
      `;
    } else if (q.question_type === "True / False") {
      // True/False choice
      ansContainer.innerHTML = `
        <label class="text-xs font-semibold text-slate-500">Correct Choice *</label>
        <select class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white select-correct">
          <option value="True" ${q.correct_answer === "True" ? "selected" : ""}>True</option>
          <option value="False" ${q.correct_answer === "False" ? "selected" : ""}>False</option>
        </select>
      `;
    } else if (q.question_type === "Fill in the Blank") {
      // Simple string answer
      ansContainer.innerHTML = `
        <label class="text-xs font-semibold text-slate-500">Correct Value (Case Insensitive) *</label>
        <input type="text" value="${q.correct_answer || ""}" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm input-correct" required placeholder="Type target blank text" />
      `;
    } else if (q.question_type === "Short Answer") {
      // Simple string answer
      ansContainer.innerHTML = `
        <label class="text-xs font-semibold text-slate-500">Correct Response (Sample/Reference) *</label>
        <input type="text" value="${q.correct_answer || ""}" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm input-correct" required placeholder="Type key phrases/rubric answer" />
      `;
    } else {
      // Essay type: no auto marking correct answer required
      ansContainer.innerHTML = `
        <label class="text-xs font-semibold text-slate-400">Essay questions must be marked manually by a teacher.</label>
      `;
    }

    // Attach local element listeners
    div.querySelector(".input-question").addEventListener("input", (e) => {
      q.question = e.target.value;
    });
    div.querySelector(".input-marks").addEventListener("input", (e) => {
      q.marks = Number(e.target.value);
      recomputeTotalMarks();
    });
    div.querySelector(".input-explanation").addEventListener("input", (e) => {
      q.explanation = e.target.value;
    });

    div.querySelector(".select-q-type").addEventListener("change", (e) => {
      q.question_type = e.target.value;
      if (q.question_type === "Multiple Choice") {
        q.options = ["", "", "", ""];
        q.correct_answer = "0";
      } else if (q.question_type === "True / False") {
        q.options = ["True", "False"];
        q.correct_answer = "True";
      } else {
        q.options = null;
        q.correct_answer = "";
      }
      renderQuestionsBuilder();
    });

    // MCQ option text edits
    div.querySelectorAll(".input-opt").forEach(input => {
      input.addEventListener("input", (e) => {
        const oIdx = Number(e.target.dataset.optIdx);
        q.options[oIdx] = e.target.value;
      });
    });

    // MCQ radio selection change
    div.querySelectorAll(".radio-correct").forEach(radio => {
      radio.addEventListener("change", (e) => {
        q.correct_answer = e.target.value;
      });
    });

    // Select dropdown corrections (T/F)
    const selectCorr = div.querySelector(".select-correct");
    if (selectCorr) {
      selectCorr.addEventListener("change", (e) => {
        q.correct_answer = e.target.value;
      });
    }

    // Text corrections (Fill blank, short response)
    const inputCorr = div.querySelector(".input-correct");
    if (inputCorr) {
      inputCorr.addEventListener("input", (e) => {
        q.correct_answer = e.target.value;
      });
    }

    // Delete question trigger
    div.querySelector(".btn-delete-q").addEventListener("click", () => {
      questionsList.splice(idx, 1);
      // Re-assign positions
      questionsList.forEach((item, i) => item.position = i);
      renderQuestionsBuilder();
    });

    questionsContainer.appendChild(div);
  });
}

// Save Editor changes
async function saveAssessment(status) {
  try {
    const title = formTitle.value.trim();
    const classId = formClass.value;
    const subjectId = formSubject.value;
    const type = formType.value;
    const duration = Number(formDuration.value);
    const passMark = Number(formPassMark.value);
    const totalMarks = Number(formTotalMarks.value);
    const instructions = formInstructions.value.trim();
    const startDate = formStartDate.value ? new Date(formStartDate.value).toISOString() : null;
    const endDate = formEndDate.value ? new Date(formEndDate.value).toISOString() : null;
    const allowResult = formAllowResult.checked;

    if (!title || !classId || !subjectId || !duration || isNaN(passMark)) {
      alert("Please fill in all required fields.");
      return;
    }

    if (!questionsList.length) {
      alert("Please add at least one question.");
      return;
    }

    // Prepare payload
    const assessmentPayload = {
      teacher_id: currentUser.id,
      class_id: classId,
      subject_id: subjectId,
      session: formSession.value,
      term: appSettings?.current_term || "term1",
      title,
      description: formDesc.value.trim(),
      assessment_type: type,
      duration,
      pass_mark: passMark,
      total_marks: totalMarks,
      instructions,
      allow_result_view: allowResult,
      start_date: startDate,
      end_date: endDate,
      status
    };

    let savedAssessmentId = currentEditingAssessmentId;

    if (currentEditingAssessmentId) {
      // Update assessment info
      const { error } = await supabase
        .from("assessments")
        .update(assessmentPayload)
        .eq("id", currentEditingAssessmentId);
      if (error) throw error;
    } else {
      // Insert new assessment
      const { data, error } = await supabase
        .from("assessments")
        .insert([assessmentPayload])
        .select()
        .single();
      if (error) throw error;
      savedAssessmentId = data.id;
    }

    // Now update questions mapping (delete old, insert new positioned list)
    // Supabase has cascade deletes on questions when assessment is updated,
    // but deleting and inserting fresh questions ensures sync.
    const { error: delErr } = await supabase
      .from("assessment_questions")
      .delete()
      .eq("assessment_id", savedAssessmentId);
    if (delErr) throw delErr;

    const questionsPayload = questionsList.map((q) => {
      // Strip IDs starting with temp_
      const cleanQ = {
        assessment_id: savedAssessmentId,
        question: q.question,
        question_type: q.question_type,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        marks: q.marks,
        position: q.position
      };
      return cleanQ;
    });

    const { error: insErr } = await supabase
      .from("assessment_questions")
      .insert(questionsPayload);
    if (insErr) throw insErr;

    alert(`Assessment saved successfully as ${status.toUpperCase()}!`);
    await refreshAssessmentsList();
    switchView(dashboardView);
  } catch (error) {
    console.error("Save assessment error:", error);
    alert("Failed to save assessment. " + error.message);
  }
}

btnSaveDraftForm.addEventListener("click", () => saveAssessment("draft"));
btnPublishForm.addEventListener("click", () => saveAssessment("published"));

// Update Status (Quick Publish/Unpublish toggle)
async function updateAssessmentStatus(id, status) {
  try {
    const { error } = await supabase
      .from("assessments")
      .update({ status })
      .eq("id", id);

    if (error) throw error;
    await refreshAssessmentsList();
  } catch (error) {
    console.error("Status update error:", error);
    alert(error.message);
  }
}

// Delete Assessment
async function deleteAssessment(id) {
  if (!confirm("Are you sure you want to delete this assessment? This will permanently delete all student submissions, questions, and scores!")) return;
  try {
    const { error } = await supabase
      .from("assessments")
      .delete()
      .eq("id", id);

    if (error) throw error;
    await refreshAssessmentsList();
  } catch (error) {
    console.error("Delete error:", error);
    alert(error.message);
  }
}

// Duplicate/Clone Assessment
async function duplicateAssessment(id) {
  try {
    const target = assessmentsList.find(x => x.id === id);
    if (!target) return;

    // Fetch questions linked to duplicate
    const { data: questions, error: qErr } = await supabase
      .from("assessment_questions")
      .select("*")
      .eq("assessment_id", id)
      .order("position", { ascending: true });
    
    if (qErr) throw qErr;

    // Create assessment duplicate payload (starts as draft)
    const duplicatePayload = {
      teacher_id: currentUser.id,
      class_id: target.class_id,
      subject_id: target.subject_id,
      session: target.session,
      term: target.term,
      title: "Copy of " + target.title,
      description: target.description,
      assessment_type: target.assessment_type,
      duration: target.duration,
      pass_mark: target.pass_mark,
      total_marks: target.total_marks,
      instructions: target.instructions,
      allow_result_view: target.allow_result_view,
      start_date: target.start_date,
      end_date: target.end_date,
      status: "draft"
    };

    const { data: clonedAssessment, error: cloneErr } = await supabase
      .from("assessments")
      .insert([duplicatePayload])
      .select()
      .single();

    if (cloneErr) throw cloneErr;

    // Clone linked questions
    if (questions && questions.length > 0) {
      const clonedQuestionsPayload = questions.map((q) => ({
        assessment_id: clonedAssessment.id,
        question: q.question,
        question_type: q.question_type,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        marks: q.marks,
        position: q.position
      }));

      const { error: insErr } = await supabase
        .from("assessment_questions")
        .insert(clonedQuestionsPayload);
      if (insErr) throw insErr;
    }

    alert(`Duplicated assessment successfully as "Copy of ${target.title}" (Saved as Draft).`);
    await refreshAssessmentsList();
  } catch (error) {
    console.error("Duplicate error:", error);
    alert(error.message);
  }
}

// Submissions List viewer loader
async function openSubmissions(assessmentId, title) {
  submissionsTitle.textContent = `Attempts — ${title}`;
  submissionsTableBody.innerHTML = `<tr><td colspan="8" class="px-6 py-4 text-center text-slate-500">Loading attempts...</td></tr>`;

  try {
    const { data, error } = await supabase
      .from("assessment_submissions")
      .select("*, students(name, admission_no)")
      .eq("assessment_id", assessmentId)
      .order("submitted_at", { ascending: false });

    if (error) throw error;

    if (!data.length) {
      submissionsTableBody.innerHTML = `<tr><td colspan="8" class="px-6 py-4 text-center text-slate-500">No attempts have been submitted for this assessment yet.</td></tr>`;
      switchView(submissionsView);
      return;
    }

    submissionsTableBody.innerHTML = "";
    data.forEach((sub) => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-50/50 border-b border-slate-100";

      const started = sub.started_at ? new Date(sub.started_at).toLocaleString() : "—";
      const submitted = sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : "—";
      const duration = sub.time_taken ? Math.floor(sub.time_taken / 60) + "m " + (sub.time_taken % 60) + "s" : "—";
      
      const scoreDisplay = sub.status === "graded" 
        ? `<strong class="text-indigo-600">${sub.total_score}</strong> (${Math.round(sub.percentage)}%)` 
        : `<span class="text-amber-600 font-medium">Pending Grading</span>`;

      let statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-100">SUBMITTED</span>`;
      if (sub.status === "graded") {
        statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-100">GRADED</span>`;
      }

      tr.innerHTML = `
        <td class="px-6 py-4 font-medium text-slate-900">${sub.students?.name || "Unknown"}</td>
        <td class="px-6 py-4 font-mono text-xs text-slate-600">${sub.students?.admission_no || "—"}</td>
        <td class="px-6 py-4 text-xs text-slate-500">${started}</td>
        <td class="px-6 py-4 text-xs text-slate-500">${submitted}</td>
        <td class="px-6 py-4 text-xs text-slate-500">${duration}</td>
        <td class="px-6 py-4 text-sm">${scoreDisplay}</td>
        <td class="px-6 py-4">${statusBadge}</td>
        <td class="px-6 py-4">
          <div class="flex gap-2">
            <button class="px-3 py-1 bg-slate-900 text-white rounded text-xs font-semibold hover:bg-slate-800 btn-grade" data-sub-id="${sub.id}">
              ${sub.status === "graded" ? "Review" : "Grade"}
            </button>
            ${sub.status === "graded" ? `
              <button class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold btn-export" data-sub-id="${sub.id}">
                Export
              </button>
            ` : ""}
          </div>
        </td>
      `;

      tr.querySelector(".btn-grade").addEventListener("click", () => openGradingModal(sub));
      if (sub.status === "graded") {
        tr.querySelector(".btn-export").addEventListener("click", () => exportSubmissionToGradebook(sub.id));
      }
      submissionsTableBody.appendChild(tr);
    });

    switchView(submissionsView);
  } catch (error) {
    console.error("Load attempts error:", error);
    alert(error.message);
  }
}

// Grading Attempt Screen
async function openGradingModal(submission) {
  activeGradingSubmission = submission;
  gradingModalStudent.textContent = `Student: ${submission.students?.name || "Scholar"} (${submission.students?.admission_no || "—"})`;
  gradingModalBody.innerHTML = `<div class="text-center py-8"><div class="loader mx-auto mb-2"></div><p class="text-slate-500 text-sm">Loading submission responses...</p></div>`;
  
  // Open modal
  gradingModal.classList.remove("hidden");
  requestAnimationFrame(() => {
    gradingModal.classList.remove("opacity-0");
    gradingModal.querySelector("div")?.classList.remove("scale-95");
  });

  try {
    // Fetch parent assessment metadata (to compute total scores)
    const { data: assessment, error: aErr } = await supabase
      .from("assessments")
      .select("total_marks")
      .eq("id", submission.assessment_id)
      .single();

    if (aErr) throw aErr;
    gradingModalMaxScore.textContent = assessment.total_marks;

    // Fetch assessment questions
    const { data: questions, error: qErr } = await supabase
      .from("assessment_questions")
      .select("*")
      .eq("assessment_id", submission.assessment_id)
      .order("position", { ascending: true });

    if (qErr) throw qErr;

    // Fetch answers submitted
    const { data: answers, error: ansErr } = await supabase
      .from("assessment_answers")
      .select("*")
      .eq("submission_id", submission.id);

    if (ansErr) throw ansErr;

    activeGradingAnswers = answers || [];

    // Render grading container
    gradingModalBody.innerHTML = "";

    questions.forEach((q, idx) => {
      const userAnsObj = activeGradingAnswers.find(x => x.question_id === q.id);
      const studentAnsText = userAnsObj?.student_answer || "—";
      const awardedMarks = userAnsObj?.awarded_marks !== null && userAnsObj?.awarded_marks !== undefined ? userAnsObj.awarded_marks : "";
      const feedback = userAnsObj?.teacher_feedback || "";

      const div = document.createElement("div");
      div.className = "p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3";
      div.dataset.questionId = q.id;
      div.dataset.maxMarks = q.marks;

      let responseHtml = "";
      if (q.question_type === "Multiple Choice") {
        const correctOptIndex = Number(q.correct_answer);
        const correctOptText = q.options?.[correctOptIndex] || "—";
        const studentOptIndex = studentAnsText !== "—" ? Number(studentAnsText) : -1;
        const studentOptText = studentOptIndex !== -1 ? q.options?.[studentOptIndex] : "No answer";

        const isCorrect = correctOptIndex === studentOptIndex;

        responseHtml = `
          <div class="text-xs space-y-1">
            <div><span class="text-slate-400 font-bold uppercase">Correct Answer:</span> <strong class="text-slate-800">${correctOptText}</strong></div>
            <div><span class="text-slate-400 font-bold uppercase">Student Response:</span> <strong class="${isCorrect ? "text-emerald-600" : "text-rose-600"}">${studentOptText}</strong></div>
          </div>
        `;
      } else if (q.question_type === "True / False") {
        const correctVal = q.correct_answer;
        const isCorrect = String(correctVal).toLowerCase() === String(studentAnsText).toLowerCase();

        responseHtml = `
          <div class="text-xs space-y-1">
            <div><span class="text-slate-400 font-bold uppercase">Correct Answer:</span> <strong class="text-slate-800">${correctVal}</strong></div>
            <div><span class="text-slate-400 font-bold uppercase">Student Response:</span> <strong class="${isCorrect ? "text-emerald-600" : "text-rose-600"}">${studentAnsText}</strong></div>
          </div>
        `;
      } else if (q.question_type === "Fill in the Blank") {
        const correctVal = q.correct_answer || "";
        const isCorrect = String(correctVal).trim().toLowerCase() === String(studentAnsText).trim().toLowerCase();

        responseHtml = `
          <div class="text-xs space-y-1">
            <div><span class="text-slate-400 font-bold uppercase">Expected Blank:</span> <strong class="text-slate-800">${correctVal}</strong></div>
            <div><span class="text-slate-400 font-bold uppercase">Student Typed:</span> <strong class="${isCorrect ? "text-emerald-600" : "text-rose-600"}">${studentAnsText}</strong></div>
          </div>
        `;
      } else if (q.question_type === "Short Answer") {
        const keywords = (q.correct_answer || "").split(",").map(k => k.trim()).filter(Boolean);
        let matchCount = 0;
        const lowerAns = String(studentAnsText).toLowerCase();
        keywords.forEach(kw => {
          if (lowerAns.includes(kw.toLowerCase())) matchCount++;
        });
        const hasKeywords = keywords.length > 0;
        const keywordMatchPct = hasKeywords ? Math.round((matchCount / keywords.length) * 100) : 0;

        responseHtml = `
          <div class="text-xs space-y-1">
            <div><span class="text-slate-400 font-bold uppercase">Target Keywords:</span> <strong class="text-slate-800">${keywords.join(", ") || q.correct_answer || "None"}</strong></div>
            <div><span class="text-slate-400 font-bold uppercase">Keyword Match Score:</span> <strong class="${keywordMatchPct >= 50 ? "text-emerald-600" : "text-amber-600"}">${keywordMatchPct}% (${matchCount}/${keywords.length} keywords)</strong></div>
            <div class="mt-2 bg-white p-3 border border-slate-200 rounded-lg text-slate-800"><span class="text-slate-400 font-bold uppercase block mb-1">Student Answer:</span>${studentAnsText}</div>
          </div>
        `;
      } else {
        // Subjective: Essay
        responseHtml = `
          <div class="text-xs space-y-1">
            <div><span class="text-slate-400 font-bold uppercase">Reference Rubric:</span> <strong class="text-slate-800">${q.explanation || "No rubric configured."}</strong></div>
            <div class="mt-2 bg-white p-3 border border-slate-200 rounded-lg text-slate-800 whitespace-pre-wrap"><span class="text-slate-400 font-bold uppercase block mb-1">Student Essay:</span>${studentAnsText}</div>
          </div>
        `;
      }

      const isAutoMarked = ["Multiple Choice", "True / False", "Fill in the Blank"].includes(q.question_type);

      div.innerHTML = `
        <div class="flex justify-between items-start gap-4">
          <h4 class="font-bold text-sm text-slate-800">Q${idx + 1}. ${q.question}</h4>
          <span class="text-xs bg-slate-200 px-2 py-0.5 rounded font-bold">Max: ${q.marks} marks</span>
        </div>
        ${responseHtml}
        
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-4 border-t border-slate-200 pt-3 mt-2 items-center">
          <div class="sm:col-span-1 space-y-1">
            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Score Awarded</label>
            <input type="number" step="0.5" max="${q.marks}" min="0" value="${awardedMarks}" class="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:border-indigo-500 outline-none val-score" />
          </div>
          <div class="sm:col-span-3 space-y-1">
            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Teacher Feedback</label>
            <input type="text" value="${feedback}" class="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:border-indigo-500 outline-none val-feedback" placeholder="e.g. Well formulated points..." />
          </div>
        </div>
      `;

      // Recalculate score changes
      const scoreInput = div.querySelector(".val-score");
      scoreInput.addEventListener("input", (e) => {
        let val = Number(e.target.value);
        if (val > q.marks) {
          e.target.value = q.marks;
          val = q.marks;
        }
        if (val < 0) {
          e.target.value = 0;
          val = 0;
        }
        userAnsObj.awarded_marks = val;
        userAnsObj.is_correct = val >= (q.marks / 2);
        recalcGradingTotal();
      });

      div.querySelector(".val-feedback").addEventListener("input", (e) => {
        userAnsObj.teacher_feedback = e.target.value;
      });

      gradingModalBody.appendChild(div);
    });

    recalcGradingTotal();
  } catch (error) {
    console.error("Grading loading error:", error);
    gradingModalBody.innerHTML = `<div class="text-center text-red-500 py-8">Failed to load grader. ${error.message}</div>`;
  }
}

// Sum grading marks
function recalcGradingTotal() {
  let sum = 0;
  activeGradingAnswers.forEach((ans) => {
    sum += Number(ans.awarded_marks || 0);
  });
  gradingModalTotalScore.textContent = sum;
}

// Save attempts grading
async function saveAttemptsGrades() {
  try {
    btnSubmitGrades.disabled = true;
    btnSubmitGrades.textContent = "Saving Grades...";

    // 1. Save answers modifications
    for (const ans of activeGradingAnswers) {
      const { error } = await supabase
        .from("assessment_answers")
        .update({
          awarded_marks: ans.awarded_marks,
          is_correct: ans.is_correct,
          teacher_feedback: ans.teacher_feedback
        })
        .eq("id", ans.id);
      if (error) throw error;
    }

    // 2. Compute final scores
    const maxScore = Number(gradingModalMaxScore.textContent || 0);
    const finalScore = Number(gradingModalTotalScore.textContent || 0);
    const finalPercentage = maxScore > 0 ? (finalScore / maxScore) * 100 : 0;

    // 3. Update parent submission metadata
    const { error: subErr } = await supabase
      .from("assessment_submissions")
      .update({
        total_score: finalScore,
        percentage: finalPercentage,
        status: "graded"
      })
      .eq("id", activeGradingSubmission.id);

    if (subErr) throw subErr;

    alert("Submissions attempt graded successfully!");
    closeGradingModal();
    // Refresh submissions listing view
    await openSubmissions(activeGradingSubmission.assessment_id, "");
  } catch (error) {
    console.error("Save grades error:", error);
    alert(error.message);
  } finally {
    btnSubmitGrades.disabled = false;
    btnSubmitGrades.textContent = "Save & Release Grade";
  }
}

btnSubmitGrades.addEventListener("click", saveAttemptsGrades);

function closeGradingModal() {
  gradingModal.classList.add("opacity-0");
  gradingModal.querySelector("div")?.classList.add("scale-95");
  setTimeout(() => gradingModal.classList.add("hidden"), 200);
}

closeGradingModalBtn.addEventListener("click", closeGradingModal);
gradingModal.addEventListener("click", (e) => {
  if (e.target === gradingModal) closeGradingModal();
});

// Manual Scores Uploader panel toggle
btnUploadScores.addEventListener("click", () => {
  parsedUploadRows = [];
  fileDetails.classList.add("hidden");
  uploadPreviewSection.classList.add("hidden");
  fileInput.value = "";
  populateUploaderAssessments();
  switchView(scoreUploaderView);
});

async function populateUploaderAssessments() {
  const cId = uploadClass.value;
  const sId = uploadSubject.value;

  if (!cId || !sId) return;

  try {
    const { data, error } = await supabase
      .from("assessments")
      .select("id, title")
      .eq("class_id", cId)
      .eq("subject_id", sId)
      .eq("teacher_id", currentUser.id);

    if (error) throw error;
    
    uploadAssessment.innerHTML = `<option value="">None (Custom upload)</option>` +
      (data || []).map(a => `<option value="${a.id}">${a.title}</option>`).join("");
  } catch (error) {
    console.error("Populate uploader assessments error:", error);
  }
}

uploadClass.addEventListener("change", populateUploaderAssessments);
uploadSubject.addEventListener("change", populateUploaderAssessments);

// Drag and drop spreadsheet handler
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("bg-indigo-50", "border-indigo-500");
});
dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("bg-indigo-50", "border-indigo-500");
});
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("bg-indigo-50", "border-indigo-500");
  const files = e.dataTransfer.files;
  if (files.length) handleFileSelected(files[0]);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFileSelected(fileInput.files[0]);
});

btnRemoveFile.addEventListener("click", () => {
  fileInput.value = "";
  fileDetails.classList.add("hidden");
  uploadPreviewSection.classList.add("hidden");
  parsedUploadRows = [];
});

// File parser and row validator
function handleFileSelected(file) {
  fileName.textContent = file.name;
  fileSize.textContent = Math.round(file.size / 1024) + " KB";
  fileDetails.classList.remove("hidden");

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      parseSheetJson(json);
    } catch (err) {
      alert("Failed to parse file. " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// Convert parsed array into row entries and check column mapping
async function parseSheetJson(rows) {
  if (!rows || rows.length < 2) {
    alert("Empty sheet. Make sure headers exist on row 1.");
    return;
  }

  const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
  
  // Identify index of target headers (Admission Number, Score, Remarks)
  const admIdx = headers.findIndex(h => h.includes("admission") || h.includes("adm"));
  const scoreIdx = headers.findIndex(h => h.includes("score") || h.includes("mark"));
  const remarkIdx = headers.findIndex(h => h.includes("remark") || h.includes("note"));

  if (admIdx === -1 || scoreIdx === -1) {
    alert("Could not map headers. The spreadsheet must contain 'Admission Number' and 'Score' columns.");
    return;
  }

  // Fetch all students registered in the selected class to match database
  const cId = uploadClass.value;
  const { data: students, error } = await supabase
    .from("students")
    .select("id, admission_no, name")
    .eq("class_id", cId);

  if (error) {
    alert("Database match failed: " + error.message);
    return;
  }

  const studentsMap = new Map((students || []).map(s => [String(s.admission_no || "").trim().toLowerCase(), s]));

  parsedUploadRows = [];
  uploadPreviewBody.innerHTML = "";

  let invalidCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const admVal = String(row[admIdx] || "").trim();
    const scoreVal = row[scoreIdx];
    const remarkVal = remarkIdx !== -1 ? String(row[remarkIdx] || "").trim() : "";

    const matchedStudent = studentsMap.get(admVal.toLowerCase());
    
    let statusText = "Validated";
    let statusClass = "text-emerald-600 font-semibold";
    let isValid = true;

    if (!matchedStudent) {
      statusText = "Student not in class";
      statusClass = "text-rose-600 font-semibold";
      isValid = false;
    } else if (scoreVal === undefined || scoreVal === null || isNaN(Number(scoreVal)) || Number(scoreVal) < 0) {
      statusText = "Invalid score";
      statusClass = "text-rose-600 font-semibold";
      isValid = false;
    }

    if (!isValid) invalidCount++;

    parsedUploadRows.push({
      student_id: matchedStudent?.id || null,
      admission_no: admVal,
      student_name: matchedStudent?.name || "—",
      score: scoreVal !== undefined && !isNaN(Number(scoreVal)) ? Number(scoreVal) : 0,
      remarks: remarkVal,
      isValid
    });

    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50 border-b border-slate-100";
    tr.innerHTML = `
      <td class="px-4 py-2 font-medium">
        <div>${matchedStudent?.name || "—"}</div>
        <div class="text-xs text-slate-400 font-mono">${admVal}</div>
      </td>
      <td class="px-4 py-2">${scoreVal !== undefined ? scoreVal : "—"}</td>
      <td class="px-4 py-2 text-slate-500 text-xs">${remarkVal}</td>
      <td class="px-4 py-2 text-xs ${statusClass}">${statusText}</td>
    `;
    uploadPreviewBody.appendChild(tr);
  }

  // Display validation totals
  validationSummary.innerHTML = `Mapped <strong>${parsedUploadRows.length}</strong> rows. <span class="${invalidCount > 0 ? "text-rose-600" : "text-emerald-600"}">${invalidCount} invalid rows</span>.`;
  btnSaveUploadedScores.disabled = invalidCount > 0 || parsedUploadRows.length === 0;

  uploadPreviewSection.classList.remove("hidden");
}

// Save uploaded scores to database
async function saveUploadedScores() {
  const cId = uploadClass.value;
  const sId = uploadSubject.value;
  const aId = uploadAssessment.value || null;

  if (!cId || !sId) {
    alert("Please select Class and Subject.");
    return;
  }

  try {
    btnSaveUploadedScores.disabled = true;
    btnSaveUploadedScores.textContent = "Importing...";

    const payload = parsedUploadRows.map(row => ({
      teacher_id: currentUser.id,
      subject_id: sId,
      class_id: cId,
      assessment_id: aId,
      student_id: row.student_id,
      score: row.score,
      remarks: row.remarks
    }));

    const { error } = await supabase
      .from("uploaded_scores")
      .insert(payload);

    if (error) throw error;

    alert("Scores imported successfully!");
    switchView(dashboardView);
  } catch (error) {
    console.error("Import error:", error);
    alert("Score import failed. " + error.message);
  } finally {
    btnSaveUploadedScores.disabled = false;
    btnSaveUploadedScores.textContent = "Import Score Sheet";
  }
}

btnSaveUploadedScores.addEventListener("click", saveUploadedScores);

logoutBtn?.addEventListener("click", async () => {
  try {
    await supabase.auth.signOut();
    window.location.replace("/");
  } catch (error) {
    console.error(error);
  }
});

async function exportSubmissionToGradebook(submissionId) {
  try {
    authLoader.style.display = "flex";

    // 1. Fetch submission details and student metadata
    const { data: sub, error: subErr } = await supabase
      .from("assessment_submissions")
      .select("*, assessments(*)")
      .eq("id", submissionId)
      .single();

    if (subErr) throw subErr;
    if (sub.status !== "graded") {
      alert("This attempt is not fully graded yet. Please grade all questions first.");
      authLoader.style.display = "none";
      return;
    }

    const a = sub.assessments;

    // 2. Validate assessment type mapping
    let targetType = a.assessment_type; // 'Test 1 (Week 3)', 'Test 2 (Week 6)', 'Test 3 (Week 9)', 'Term Exam', 'Practice Questions'
    let maxScore = 0;
    if (targetType === "Test 1 (Week 3)") maxScore = 15;
    else if (targetType === "Test 2 (Week 6)") maxScore = 15;
    else if (targetType === "Test 3 (Week 9)") maxScore = 30;
    else if (targetType === "Term Exam") maxScore = 70;
    else {
      alert(`Assessment of type "${targetType}" cannot be exported to the official academic results sheet.`);
      authLoader.style.display = "none";
      return;
    }

    // 3. Compute scaled score
    const totalMarks = Number(a.total_marks || 0);
    if (totalMarks <= 0) {
      alert("Invalid assessment configuration: total marks must be greater than zero.");
      authLoader.style.display = "none";
      return;
    }
    const rawScore = Number(sub.total_score || 0);
    const scaledScore = Math.round((rawScore / totalMarks) * maxScore);

    // 4. Query existing results record
    const { data: existingResult, error: resErr } = await supabase
      .from("results")
      .select("*")
      .eq("student_id", sub.student_id)
      .eq("subject_id", a.subject_id)
      .eq("term", a.term)
      .maybeSingle();

    if (resErr) throw resErr;

    let rawBreakdown = emptyRawScores();
    if (existingResult) {
      rawBreakdown = normalizeBreakdown(existingResult);
    }

    // 5. Update target breakdown slot
    if (targetType === "Test 1 (Week 3)") rawBreakdown.tests[0] = String(scaledScore);
    else if (targetType === "Test 2 (Week 6)") rawBreakdown.tests[1] = String(scaledScore);
    else if (targetType === "Test 3 (Week 9)") rawBreakdown.tests[2] = String(scaledScore);
    else if (targetType === "Term Exam") rawBreakdown.exam = String(scaledScore);

    // 6. Compute new total metrics
    const finalResult = calculateStudentResult(rawBreakdown);
    const storedMetrics = toStoredScores(finalResult);

    // 7. Upsert results database record
    const payload = {
      student_id: sub.student_id,
      subject_id: a.subject_id,
      term: a.term,
      submitted_by: currentUser.id,
      status: existingResult?.status || "draft",
      score_breakdown: rawBreakdown,
      cw: storedMetrics.cw,
      hw: storedMetrics.hw,
      test: storedMetrics.test,
      project: storedMetrics.project,
      exam: storedMetrics.exam,
      total: storedMetrics.total,
      grade: storedMetrics.grade
    };

    // If existing record has an id, merge it to keep constraints
    if (existingResult?.id) {
      payload.id = existingResult.id;
    }

    const { error: upsertErr } = await supabase
      .from("results")
      .upsert(payload, { onConflict: "student_id,subject_id,term" });

    if (upsertErr) throw upsertErr;

    alert(`Successfully exported to grading sheet! Score scaled to: ${scaledScore} / ${maxScore}.`);
  } catch (error) {
    console.error("Export Error:", error);
    alert("Export failed: " + error.message);
  } finally {
    authLoader.style.display = "none";
  }
}

// Start integration
init();
