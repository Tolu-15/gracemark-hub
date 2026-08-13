import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";

// DOM references
const authLoader = document.getElementById("authLoader");
const logoutBtn = document.getElementById("logoutBtn");

// Views
const listView = document.getElementById("listView");
const instructionsView = document.getElementById("instructionsView");
const quizView = document.getElementById("quizView");
const resultsView = document.getElementById("resultsView");

// Search filters & lists
const typeFilter = document.getElementById("typeFilter");
const assessmentsListContainer = document.getElementById("assessmentsList");

// Back buttons
const btnBackToList = document.getElementById("btnBackToList");
const btnResultsBack = document.getElementById("btnResultsBack");

// Instructions view elements
const instTitle = document.getElementById("instTitle");
const instDesc = document.getElementById("instDesc");
const instDuration = document.getElementById("instDuration");
const instQuestions = document.getElementById("instQuestions");
const instMaxScore = document.getElementById("instMaxScore");
const instPassMark = document.getElementById("instPassMark");
const instDetails = document.getElementById("instDetails");
const btnStartQuiz = document.getElementById("btnStartQuiz");

// Quiz environment elements
const quizTitle = document.getElementById("quizTitle");
const quizSubjectLabel = document.getElementById("quizSubjectLabel");
const timerDisplay = document.getElementById("timerDisplay");
const questionNavGrid = document.getElementById("questionNavGrid");
const questionCounter = document.getElementById("questionCounter");
const questionMarks = document.getElementById("questionMarks");
const activeQuestionText = document.getElementById("activeQuestionText");
const activeAnswerInputArea = document.getElementById("activeAnswerInputArea");
const btnPrevQuestion = document.getElementById("btnPrevQuestion");
const btnNextQuestion = document.getElementById("btnNextQuestion");
const btnSubmitQuiz = document.getElementById("btnSubmitQuiz");

// Results view elements
const resultsSubjectLabel = document.getElementById("resultsSubjectLabel");
const resultsScoreHeader = document.getElementById("resultsScoreHeader");
const resultsBreakdownSection = document.getElementById("resultsBreakdownSection");
const resultsQuestionsList = document.getElementById("resultsQuestionsList");

// State management
let currentStudent = null;
let assignedAssessments = [];
let selectedAssessment = null;

// Quiz attempt state
let attemptQuestions = [];
let studentAnswers = {}; // questionId -> answer text
let currentQuestionIndex = 0;
let timerInterval = null;
let secondsRemaining = 0;
let submissionRecord = null;
let startTime = null;

// Initialize Student Portal
async function init() {
  try {
    const ok = await requireRole("student", { redirectTo: "/" });
    if (!ok) return;

    // Load student record
    let { data: student, error: stdErr } = await supabase
      .from("students")
      .select("id, class_id")
      .eq("user_id", ok.user.id)
      .maybeSingle();

    if (!student) {
      const displayName = ok.user?.user_metadata?.display_name || ok.user?.email?.split("@")[0] || "Student";
      const admissionNo = "GMA" + Math.floor(100000 + Math.random() * 900000);
      const { data: defaultClass } = await supabase.from("classes").select("id").limit(1).maybeSingle();

      const { data: newStudent } = await supabase
        .from("students")
        .upsert([{ user_id: ok.user.id, class_id: defaultClass?.id || null, admission_no: admissionNo, name: displayName }], { onConflict: "user_id" })
        .select("id, class_id")
        .maybeSingle();

      student = newStudent;
    }

    currentStudent = student;

    // Fetch assessments assigned
    await refreshAssessments();

    authLoader.style.display = "none";
  } catch (error) {
    console.error("Init Error:", error);
    alert("Failed to load student assessments. " + error.message);
  }
}

// Fetch published assessments & CBT exams for student class
async function refreshAssessments() {
  try {
    const { data: legacyData } = await supabase
      .from("assessments")
      .select("*, subjects(name)")
      .eq("class_id", currentStudent.class_id)
      .eq("status", "published")
      .order("created_at", { ascending: false });

    const { data: cbtData } = await supabase
      .from("cbt_exams")
      .select("*, subjects(name)")
      .eq("class_id", currentStudent.class_id)
      .eq("is_published", true)
      .order("created_at", { ascending: false });

    const mappedCbt = (cbtData || []).map(c => ({
      id: c.id,
      title: c.title,
      description: c.description,
      assessment_type: "CBT Online Exam",
      duration: c.duration_minutes,
      total_marks: c.pass_mark * 2 || 100,
      pass_mark: c.pass_mark,
      instructions: c.description || "Complete all multiple choice questions before time runs out.",
      subjects: c.subjects,
      allow_result_view: true,
      is_cbt: true
    }));

    assignedAssessments = [...(legacyData || []), ...mappedCbt];
    renderAssessmentsList();
  } catch (error) {
    console.error("Fetch assessments error:", error);
  }
}

// Render available assessments
function renderAssessmentsList() {
  const typeVal = typeFilter.value;
  let filtered = [...assignedAssessments];

  if (typeVal) {
    filtered = filtered.filter(a => a.assessment_type === typeVal);
  }

  if (!filtered.length) {
    assessmentsListContainer.innerHTML = `
      <div class="col-span-full p-8 text-center text-slate-500 bg-white border border-slate-200 rounded-xl shadow-sm">
        No assessments assigned to your class.
      </div>
    `;
    return;
  }

  assessmentsListContainer.innerHTML = "";
  filtered.forEach(async (a) => {
    // Check if student has submission
    const { data: subData, error } = await supabase
      .from("assessment_submissions")
      .select("*")
      .eq("assessment_id", a.id)
      .eq("student_id", currentStudent.id)
      .maybeSingle();

    const card = document.createElement("article");
    card.className = "bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow";

    let btnHtml = "";
    let badgeHtml = "";

    if (subData) {
      if (subData.status === "graded") {
        badgeHtml = `<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">Graded</span>`;
      } else {
        badgeHtml = `<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">Submitted</span>`;
      }

      if (a.allow_result_view || subData.status === "graded") {
        btnHtml = `<button class="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 btn-review" data-sub-id="${subData.id}">View Results</button>`;
      } else {
        btnHtml = `<button class="w-full px-4 py-2 border border-slate-200 text-slate-400 rounded-lg text-sm font-semibold cursor-not-allowed" disabled>Results Pending</button>`;
      }
    } else {
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-100">Pending</span>`;
      btnHtml = `<button class="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 btn-start" data-id="${a.id}">Start Assessment</button>`;
    }

    card.innerHTML = `
      <div>
        <div class="flex justify-between items-start mb-3">
          ${badgeHtml}
          <span class="text-xs text-slate-400 font-bold uppercase">${a.assessment_type}</span>
        </div>
        <h3 class="text-base font-bold text-slate-900 mb-1">${a.title}</h3>
        <p class="text-xs text-slate-500 mb-4 line-clamp-2">${a.description || "No description provided."}</p>
        
        <div class="grid grid-cols-2 gap-y-2 border-t border-slate-100 pt-3 mb-4 text-xs">
          <div><span class="text-slate-400 font-medium">Subject:</span> <strong class="text-slate-700">${a.subjects?.name || "—"}</strong></div>
          <div><span class="text-slate-400 font-medium">Duration:</span> <strong class="text-slate-700">${a.duration} mins</strong></div>
          <div><span class="text-slate-400 font-medium">Marks:</span> <strong class="text-slate-700">${a.total_marks} marks</strong></div>
          <div><span class="text-slate-400 font-medium">Pass Mark:</span> <strong class="text-slate-700">${a.pass_mark} marks</strong></div>
        </div>
      </div>
      
      <div class="pt-2">
        ${btnHtml}
      </div>
    `;

    if (!subData) {
      card.querySelector(".btn-start").addEventListener("click", () => openInstructions(a));
    } else if (a.allow_result_view || subData.status === "graded") {
      card.querySelector(".btn-review").addEventListener("click", () => openResultsReview(subData.id, a.subjects?.name));
    }

    assessmentsListContainer.appendChild(card);
  });
}

typeFilter.addEventListener("change", renderAssessmentsList);

// Instructions View
function openInstructions(assessment) {
  selectedAssessment = assessment;
  instTitle.textContent = assessment.title;
  instDesc.textContent = assessment.description || "No description provided.";
  instDuration.textContent = assessment.duration + " mins";
  instPassMark.textContent = assessment.pass_mark + " marks";
  instMaxScore.textContent = assessment.total_marks + " marks";
  instDetails.textContent = assessment.instructions || "Follow all instructions. Check your answers carefully before final submission.";

  // Fetch count of questions
  const questionsTable = assessment.is_cbt ? "cbt_questions" : "assessment_questions";
  const foreignKey = assessment.is_cbt ? "exam_id" : "assessment_id";

  supabase
    .from(questionsTable)
    .select("id", { count: "exact", head: true })
    .eq(foreignKey, assessment.id)
    .then(({ count }) => {
      instQuestions.textContent = count || 0;
    });

  switchView(instructionsView);
}

btnBackToList.addEventListener("click", () => switchView(listView));
btnResultsBack.addEventListener("click", () => switchView(listView));

// Start the quiz tracker session
async function startQuizAttempt() {
  if (!confirm("Do you want to start this assessment now? The timer will start immediately.")) return;

  try {
    authLoader.style.display = "flex";
    
    // 1. Fetch questions list
    if (selectedAssessment.is_cbt) {
      const { data: qData, error: qErr } = await supabase
        .from("cbt_questions")
        .select("*")
        .eq("exam_id", selectedAssessment.id)
        .order("created_at", { ascending: true });

      if (qErr) throw qErr;

      attemptQuestions = (qData || []).map(q => ({
        id: q.id,
        question: q.question_text,
        question_type: "Multiple Choice",
        options: Array.isArray(q.options) ? q.options : [],
        correct_answer: String(q.correct_option_index),
        marks: q.points || 1
      }));
    } else {
      const { data: questions, error: qErr } = await supabase
        .from("assessment_questions")
        .select("*")
        .eq("assessment_id", selectedAssessment.id)
        .order("position", { ascending: true });

      if (qErr) throw qErr;
      attemptQuestions = questions || [];
    }

    studentAnswers = {};
    currentQuestionIndex = 0;
    startTime = new Date();

    // Initialize answer slots in local state
    attemptQuestions.forEach(q => {
      studentAnswers[q.id] = "";
    });

    // 2. Create the submission record in database
    if (selectedAssessment.is_cbt) {
      const { data: submission } = await supabase
        .from("cbt_submissions")
        .upsert([{
          exam_id: selectedAssessment.id,
          student_id: currentStudent.id,
          score: 0,
          total_questions: attemptQuestions.length,
          passed: false,
          answers: {}
        }], { onConflict: "exam_id, student_id" })
        .select()
        .single();
      
      submissionRecord = submission || { id: "cbt_" + Date.now() };
    } else {
      const { data: submission, error: subErr } = await supabase
        .from("assessment_submissions")
        .insert([{
          assessment_id: selectedAssessment.id,
          student_id: currentStudent.id,
          started_at: startTime.toISOString(),
          status: "started"
        }])
        .select()
        .single();

      if (subErr) throw subErr;
      submissionRecord = submission;
    }

    // 3. Initialize quiz timer
    secondsRemaining = selectedAssessment.duration * 60;
    startTimer();

    // 4. Render quiz environment
    quizTitle.textContent = selectedAssessment.title;
    quizSubjectLabel.textContent = selectedAssessment.subjects?.name || "Subject";
    renderQuestionNavigation();
    loadQuestion(0);

    authLoader.style.display = "none";
    switchView(quizView);
  } catch (error) {
    authLoader.style.display = "none";
    console.error("Start quiz error:", error);
    alert("Failed to start assessment. " + error.message);
  }
}

btnStartQuiz.addEventListener("click", startQuizAttempt);

// Timer loop
function startTimer() {
  clearInterval(timerInterval);
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    secondsRemaining--;
    updateTimerDisplay();

    if (secondsRemaining <= 0) {
      clearInterval(timerInterval);
      alert("Time has expired! Your attempt is being submitted automatically.");
      submitQuizAttempt(true); // auto-submit
    }
  }, 1000);
}

function updateTimerDisplay() {
  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  timerDisplay.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  // Highlight timer red when under 5 minutes
  if (secondsRemaining < 300) {
    timerDisplay.classList.add("text-rose-600");
    timerDisplay.parentElement.classList.add("bg-rose-50", "border-rose-200");
  } else {
    timerDisplay.classList.remove("text-rose-600");
    timerDisplay.parentElement.classList.remove("bg-rose-50", "border-rose-200");
  }
}

// Side Question Numbers grid builder
function renderQuestionNavigation() {
  questionNavGrid.innerHTML = "";
  attemptQuestions.forEach((q, idx) => {
    const btn = document.createElement("button");
    btn.textContent = idx + 1;
    btn.className = "w-10 h-10 rounded-lg flex items-center justify-center font-bold transition-all select-none border";

    // Set classes based on state
    updateNavButtonClass(btn, q.id, idx);

    btn.addEventListener("click", () => {
      saveCurrentQuestionAnswer();
      loadQuestion(idx);
    });

    questionNavGrid.appendChild(btn);
  });
}

function updateNavButtonClass(btn, questionId, idx) {
  const isAnswered = studentAnswers[questionId] !== "";
  const isCurrent = currentQuestionIndex === idx;

  btn.className = "w-10 h-10 rounded-lg flex items-center justify-center font-bold transition-all select-none border";

  if (isCurrent) {
    btn.classList.add("border-2", "border-indigo-600", "text-indigo-600");
  } else if (isAnswered) {
    btn.classList.add("bg-emerald-100", "border-emerald-300", "text-emerald-800");
  } else {
    btn.classList.add("bg-slate-100", "border-slate-200", "text-slate-600");
  }
}

// Load targeted question
function loadQuestion(index) {
  currentQuestionIndex = index;
  const q = attemptQuestions[index];
  if (!q) return;

  questionCounter.textContent = `Question ${index + 1} of ${attemptQuestions.length}`;
  questionMarks.textContent = `${q.marks} mark${q.marks === 1 ? "" : "s"}`;
  activeQuestionText.textContent = q.question;

  // Build options inputs
  activeAnswerInputArea.innerHTML = "";
  const currentAnswer = studentAnswers[q.id];

  if (q.question_type === "Multiple Choice") {
    const opts = q.options || [];
    activeAnswerInputArea.innerHTML = `
      <div class="space-y-3">
        ${opts.map((opt, oIdx) => `
          <label class="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
            <input type="radio" name="mcq_option" value="${oIdx}" ${String(currentAnswer) === String(oIdx) ? "checked" : ""} class="w-4 h-4 text-indigo-600 border-slate-300 focus:ring-indigo-500" />
            <span class="text-sm font-medium text-slate-700">${opt}</span>
          </label>
        `).join("")}
      </div>
    `;
  } else if (q.question_type === "True / False") {
    activeAnswerInputArea.innerHTML = `
      <div class="grid grid-cols-2 gap-4">
        <label class="flex items-center justify-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
          <input type="radio" name="tf_option" value="True" ${currentAnswer === "True" ? "checked" : ""} class="w-4 h-4 text-indigo-600 border-slate-300 focus:ring-indigo-500" />
          <span class="font-bold text-slate-700">True</span>
        </label>
        <label class="flex items-center justify-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
          <input type="radio" name="tf_option" value="False" ${currentAnswer === "False" ? "checked" : ""} class="w-4 h-4 text-indigo-600 border-slate-300 focus:ring-indigo-500" />
          <span class="font-bold text-slate-700">False</span>
        </label>
      </div>
    `;
  } else if (q.question_type === "Fill in the Blank") {
    activeAnswerInputArea.innerHTML = `
      <input type="text" value="${currentAnswer}" class="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-indigo-500 input-quiz-answer" placeholder="Type your answer here..." />
    `;
  } else if (q.question_type === "Short Answer") {
    activeAnswerInputArea.innerHTML = `
      <input type="text" value="${currentAnswer}" class="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-indigo-500 input-quiz-answer" placeholder="Type a concise short response..." />
    `;
  } else {
    // Essay
    activeAnswerInputArea.innerHTML = `
      <textarea rows="6" class="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-indigo-500 textarea-quiz-answer" placeholder="Type your full essay response here...">${currentAnswer}</textarea>
    `;
  }

  // Update nav buttons selection outline
  const navBtns = questionNavGrid.querySelectorAll("button");
  attemptQuestions.forEach((item, idx) => {
    updateNavButtonClass(navBtns[idx], item.id, idx);
  });

  // Enable/Disable buttons
  btnPrevQuestion.disabled = index === 0;
  btnPrevQuestion.classList.toggle("opacity-50", index === 0);

  const isLast = index === attemptQuestions.length - 1;
  btnNextQuestion.classList.toggle("hidden", isLast);
  btnSubmitQuiz.classList.toggle("hidden", !isLast);
}

// Read and save value of current input to answers object
function saveCurrentQuestionAnswer() {
  const q = attemptQuestions[currentQuestionIndex];
  if (!q) return;

  if (q.question_type === "Multiple Choice" || q.question_type === "True / False") {
    const radio = activeAnswerInputArea.querySelector("input[type='radio']:checked");
    studentAnswers[q.id] = radio ? radio.value : "";
  } else if (q.question_type === "Fill in the Blank" || q.question_type === "Short Answer") {
    const input = activeAnswerInputArea.querySelector(".input-quiz-answer");
    studentAnswers[q.id] = input ? input.value.trim() : "";
  } else if (q.question_type === "Essay") {
    const text = activeAnswerInputArea.querySelector(".textarea-quiz-answer");
    studentAnswers[q.id] = text ? text.value.trim() : "";
  }
}

// Nav actions
btnPrevQuestion.addEventListener("click", () => {
  saveCurrentQuestionAnswer();
  if (currentQuestionIndex > 0) loadQuestion(currentQuestionIndex - 1);
});

btnNextQuestion.addEventListener("click", () => {
  saveCurrentQuestionAnswer();
  if (currentQuestionIndex < attemptQuestions.length - 1) loadQuestion(currentQuestionIndex + 1);
});

// Final Submit
async function submitQuizAttempt(auto = false) {
  if (!auto && !confirm("Are you sure you want to submit your assessment? You cannot make changes after this.")) return;

  saveCurrentQuestionAnswer();
  clearInterval(timerInterval);

  authLoader.style.display = "flex";
  
  try {
    const submitTime = new Date();
    const timeTaken = Math.round((submitTime - startTime) / 1000);

    let subjectiveExists = false;
    let autoMarksTotal = 0;
    
    // Prepare answers list payload & grade auto-marked items
    const answersPayload = attemptQuestions.map((q) => {
      const studentAnsText = studentAnswers[q.id] || "";
      let isCorrect = null;
      let awardedMarks = null;

      const isAutoMarked = ["Multiple Choice", "True / False", "Fill in the Blank"].includes(q.question_type);

      if (isAutoMarked) {
        if (q.question_type === "Multiple Choice" || q.question_type === "True / False") {
          isCorrect = String(studentAnsText).toLowerCase() === String(q.correct_answer).toLowerCase();
        } else {
          // Case insensitive string compare for blanks
          isCorrect = String(studentAnsText).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase();
        }
        awardedMarks = isCorrect ? q.marks : 0;
        autoMarksTotal += awardedMarks;
      } else {
        // Short Answer and Essay need teacher review
        subjectiveExists = true;
      }

      return {
        submission_id: submissionRecord.id,
        question_id: q.id,
        student_answer: studentAnsText,
        awarded_marks: awardedMarks,
        is_correct: isCorrect
      };
    });

    // 1. Bulk insert responses into database
    const { error: insErr } = await supabase
      .from("assessment_answers")
      .insert(answersPayload);
    
    if (insErr) throw insErr;

    // 2. Finalize submission score
    let finalStatus = "graded";
    let finalScore = autoMarksTotal;
    
    if (subjectiveExists) {
      finalStatus = "submitted";
      // Auto-marked marks still serve as starting score reference
    }

    const percentage = selectedAssessment.total_marks > 0 
      ? (finalScore / selectedAssessment.total_marks) * 100 
      : 0;

    // 3. Update database submission details
    const { error: subErr } = await supabase
      .from("assessment_submissions")
      .update({
        submitted_at: submitTime.toISOString(),
        total_score: finalScore,
        percentage,
        status: finalStatus,
        time_taken: timeTaken
      })
      .eq("id", submissionRecord.id);

    if (subErr) throw subErr;

    authLoader.style.display = "none";
    alert("Assessment submitted successfully!");

    // Check if result details visibility is enabled
    if (selectedAssessment.allow_result_view || finalStatus === "graded") {
      openResultsReview(submissionRecord.id, selectedAssessment.subjects?.name);
    } else {
      // Show list overview dashboard
      await refreshAssessments();
      switchView(listView);
    }
  } catch (error) {
    authLoader.style.display = "none";
    console.error("Submit assessment error:", error);
    alert("Failed to submit assessment: " + error.message);
  }
}

btnSubmitQuiz.addEventListener("click", () => submitQuizAttempt(false));

// Results Breakdown / Review Screen
async function openResultsReview(submissionId, subjectName) {
  authLoader.style.display = "flex";
  resultsQuestionsList.innerHTML = "";
  resultsSubjectLabel.textContent = subjectName || "Subject Details";

  try {
    // 1. Fetch submission details
    const { data: sub, error: subErr } = await supabase
      .from("assessment_submissions")
      .select("*, assessments(*)")
      .eq("id", submissionId)
      .single();

    if (subErr) throw subErr;
    const a = sub.assessments;

    // Build overall summary block
    const scoreVal = sub.status === "graded" 
      ? `<span class="text-3xl font-extrabold text-indigo-600 block mt-1">${sub.total_score} <span class="text-slate-400 text-sm">/ ${a.total_marks}</span></span>`
      : `<span class="text-amber-600 font-semibold block mt-2 text-sm">Grading Pending</span>`;

    const statusBadge = sub.status === "graded"
      ? (sub.total_score >= a.pass_mark 
        ? `<div class="p-3 bg-emerald-50 rounded-lg border border-emerald-200"><span class="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block">Outcome</span><strong class="text-emerald-700 text-lg">PASSED</strong></div>` 
        : `<div class="p-3 bg-rose-50 rounded-lg border border-rose-200"><span class="text-[10px] font-bold text-rose-500 uppercase tracking-wider block">Outcome</span><strong class="text-rose-700 text-lg">FAILED</strong></div>`)
      : `<div class="p-3 bg-slate-50 rounded-lg border border-slate-200"><span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Outcome</span><strong class="text-slate-600 text-base">PENDING</strong></div>`;

    resultsScoreHeader.innerHTML = `
      <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Your Score</span>
        ${scoreVal}
      </div>
      <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Required Pass Mark</span>
        <strong class="text-slate-700 text-xl block mt-2">${a.pass_mark} marks</strong>
      </div>
      ${statusBadge}
    `;

    // 2. Fetch questions and answers details (if allowed to view)
    if (a.allow_result_view || sub.status === "graded") {
      resultsBreakdownSection.classList.remove("hidden");

      const { data: questions, error: qErr } = await supabase
        .from("assessment_questions")
        .select("*")
        .eq("assessment_id", a.id)
        .order("position", { ascending: true });
      if (qErr) throw qErr;

      const { data: answers, error: ansErr } = await supabase
        .from("assessment_answers")
        .select("*")
        .eq("submission_id", submissionId);
      if (ansErr) throw ansErr;

      questions.forEach((q, idx) => {
        const ansObj = answers.find(x => x.question_id === q.id);
        const studentAns = ansObj?.student_answer || "—";
        const teacherFb = ansObj?.teacher_feedback || "";

        let statusClass = "border-slate-200 bg-slate-50/50";
        let outcomeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">UNMARKED</span>`;

        if (ansObj) {
          if (ansObj.is_correct === true) {
            statusClass = "border-emerald-200 bg-emerald-50/20";
            outcomeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">CORRECT</span>`;
          } else if (ansObj.is_correct === false) {
            statusClass = "border-rose-200 bg-rose-50/20";
            outcomeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">WRONG</span>`;
          }
        }

        const div = document.createElement("div");
        div.className = `p-4 border rounded-xl space-y-3 ${statusClass}`;

        let detailHtml = "";
        if (q.question_type === "Multiple Choice") {
          const cIdx = Number(q.correct_answer);
          const sIdx = studentAns !== "—" ? Number(studentAns) : -1;
          
          detailHtml = `
            <div class="text-xs space-y-1">
              <div><span class="text-slate-400 font-bold uppercase">Expected Choice:</span> <strong class="text-slate-800">${q.options?.[cIdx] || "—"}</strong></div>
              <div><span class="text-slate-400 font-bold uppercase">Your Selection:</span> <strong class="text-slate-800">${sIdx !== -1 ? q.options?.[sIdx] : "None"}</strong></div>
            </div>
          `;
        } else if (q.question_type === "True / False") {
          detailHtml = `
            <div class="text-xs space-y-1">
              <div><span class="text-slate-400 font-bold uppercase">Expected Choice:</span> <strong class="text-slate-800">${q.correct_answer}</strong></div>
              <div><span class="text-slate-400 font-bold uppercase">Your Selection:</span> <strong class="text-slate-800">${studentAns}</strong></div>
            </div>
          `;
        } else if (q.question_type === "Fill in the Blank" || q.question_type === "Short Answer") {
          detailHtml = `
            <div class="text-xs space-y-1">
              <div><span class="text-slate-400 font-bold uppercase">Expected Answer:</span> <strong class="text-slate-800">${q.correct_answer || "—"}</strong></div>
              <div><span class="text-slate-400 font-bold uppercase">Your Typed Answer:</span> <strong class="text-slate-800">${studentAns}</strong></div>
            </div>
          `;
        } else {
          // Essay
          detailHtml = `
            <div class="text-xs space-y-1">
              <div class="bg-white p-3 border rounded-lg whitespace-pre-wrap"><span class="text-slate-400 font-bold uppercase block mb-1">Your Submission:</span>${studentAns}</div>
            </div>
          `;
        }

        const scoreDisplay = ansObj?.awarded_marks !== null ? `${ansObj.awarded_marks} / ${q.marks}` : `— / ${q.marks}`;

        div.innerHTML = `
          <div class="flex justify-between items-start gap-4">
            <h4 class="font-semibold text-sm text-slate-800">${idx + 1}. ${q.question}</h4>
            <div class="flex items-center gap-2">
              ${outcomeBadge}
              <span class="text-xs font-bold bg-white border border-slate-200 px-2 py-0.5 rounded">${scoreDisplay} marks</span>
            </div>
          </div>
          ${detailHtml}
          ${q.explanation ? `<div class="text-xs text-indigo-600 bg-indigo-50/50 p-2.5 rounded-lg border border-indigo-100"><span class="font-bold">Explanation:</span> ${q.explanation}</div>` : ""}
          ${teacherFb ? `<div class="text-xs text-slate-600 bg-slate-100 p-2.5 rounded-lg border"><span class="font-bold text-slate-700">Teacher Feedback:</span> "${teacherFb}"</div>` : ""}
        `;

        resultsQuestionsList.appendChild(div);
      });
    } else {
      resultsBreakdownSection.classList.add("hidden");
    }

    authLoader.style.display = "none";
    switchView(resultsView);
  } catch (error) {
    authLoader.style.display = "none";
    console.error("View results details error:", error);
    alert("Could not load result reviews. " + error.message);
  }
}

// Switch helper for main screen sections
function switchView(view) {
  [listView, instructionsView, quizView, resultsView].forEach(v => v.classList.add("hidden"));
  view.classList.remove("hidden");
}

logoutBtn?.addEventListener("click", async () => {
  try {
    await supabase.auth.signOut();
    window.location.replace("/");
  } catch (error) {
    console.error(error);
  }
});

// Run
init();
