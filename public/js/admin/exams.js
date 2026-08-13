import { supabase } from "/supabase.js";

document.addEventListener("DOMContentLoaded", async () => {
  const authLoader = document.getElementById("authLoader");
  const examsGrid = document.getElementById("examsGrid");

  const openExamModalBtn = document.getElementById("openExamModalBtn");
  const examModal = document.getElementById("examModal");
  const closeExamModalBtn = document.getElementById("closeExamModalBtn");
  const cancelExamModalBtn = document.getElementById("cancelExamModalBtn");
  const examFormEl = document.getElementById("examFormEl");

  const examTitleInput = document.getElementById("examTitleInput");
  const examDescInput = document.getElementById("examDescInput");
  const examClassSelect = document.getElementById("examClassSelect");
  const examDurationInput = document.getElementById("examDurationInput");
  const examPassMarkInput = document.getElementById("examPassMarkInput");
  const examIsPublishedInput = document.getElementById("examIsPublishedInput");

  const questionsModal = document.getElementById("questionsModal");
  const closeQuestionsModalBtn = document.getElementById("closeQuestionsModalBtn");
  const qModalExamTitle = document.getElementById("qModalExamTitle");
  const qModalSubTitle = document.getElementById("qModalSubTitle");
  const addQuestionForm = document.getElementById("addQuestionForm");
  const qTextInput = document.getElementById("qTextInput");
  const optA = document.getElementById("optA");
  const optB = document.getElementById("optB");
  const optC = document.getElementById("optC");
  const optD = document.getElementById("optD");
  const correctOptSelect = document.getElementById("correctOptSelect");
  const qCountDisplay = document.getElementById("qCountDisplay");
  const questionsContainer = document.getElementById("questionsContainer");

  let classes = [];
  let currentExamId = null;

  // 1. Auth Guard
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/";
      return;
    }
    const { data: userProfile } = await supabase
      .from("users")
      .select("role")
      .eq("auth_id", session.user.id)
      .maybeSingle();

    if (userProfile?.role !== "admin") {
      window.location.href = "/";
      return;
    }
    if (authLoader) authLoader.style.display = "none";
  } catch (err) {
    console.error("Auth error:", err);
    window.location.href = "/";
    return;
  }

  await loadClasses();
  await loadExams();

  async function loadClasses() {
    const { data } = await supabase.from("classes").select("id, name").order("name");
    classes = data || [];
    examClassSelect.innerHTML = classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  }

  async function loadExams() {
    examsGrid.innerHTML = `
      <div class="col-span-full text-center py-12 text-slate-400">
        <div class="w-6 h-6 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
        Loading CBT exams...
      </div>
    `;

    const { data: exams, error } = await supabase
      .from("cbt_exams")
      .select("*, classes(name), cbt_questions(count), cbt_submissions(count)")
      .order("created_at", { ascending: false });

    if (error) {
      examsGrid.innerHTML = `<div class="col-span-full text-center text-red-500 py-8">Failed to load exams: ${error.message}</div>`;
      return;
    }

    if (!exams || exams.length === 0) {
      examsGrid.innerHTML = `
        <div class="col-span-full bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
          <div class="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </div>
          <h3 class="text-base font-bold text-slate-800">No CBT Exams Created Yet</h3>
          <p class="text-xs text-slate-500 max-w-sm mx-auto">Create online exams for each class, add multiple choice questions, set timers, and publish them for students.</p>
        </div>
      `;
      return;
    }

    examsGrid.innerHTML = exams.map(exam => {
      const qCount = exam.cbt_questions?.[0]?.count || 0;
      const subCount = exam.cbt_submissions?.[0]?.count || 0;

      return `
        <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition">
          <div>
            <div class="flex items-start justify-between gap-2 mb-2">
              <span class="px-2.5 py-1 text-[11px] font-bold uppercase rounded-full ${exam.is_published ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}">
                ${exam.is_published ? "Published" : "Draft"}
              </span>
              <span class="text-xs text-slate-400 font-semibold">${exam.duration_minutes} Mins</span>
            </div>
            <h3 class="text-lg font-bold text-slate-900 leading-snug">${exam.title}</h3>
            <p class="text-xs text-slate-500 mt-1 line-clamp-2">${exam.description || "No instructions provided."}</p>
          </div>

          <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Class: <strong class="text-slate-900">${exam.classes?.name || "General"}</strong></span>
            <span>Questions: <strong class="text-indigo-600">${qCount}</strong></span>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <button type="button" data-action="questions" data-id="${exam.id}" data-title="${encodeURIComponent(exam.title)}" class="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition">
              <svg class="w-4 h-4 text-indigo-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              Manage Questions
            </button>
            <button type="button" data-action="toggle-publish" data-id="${exam.id}" data-status="${exam.is_published}" class="px-3 py-2 border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold transition">
              ${exam.is_published ? "Unpublish" : "Publish"}
            </button>
            <button type="button" data-action="delete" data-id="${exam.id}" class="p-2 text-red-500 hover:bg-red-50 rounded-xl transition" title="Delete Exam">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join("");

    // Attach Action Listeners
    examsGrid.querySelectorAll("button[data-action='questions']").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const title = decodeURIComponent(btn.getAttribute("data-title"));
        openQuestionsModal(id, title);
      });
    });

    examsGrid.querySelectorAll("button[data-action='toggle-publish']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const status = btn.getAttribute("data-status") === "true";
        await supabase.from("cbt_exams").update({ is_published: !status }).eq("id", id);
        await loadExams();
      });
    });

    examsGrid.querySelectorAll("button[data-action='delete']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (confirm("Are you sure you want to delete this CBT exam? All questions and student results will be removed.")) {
          await supabase.from("cbt_exams").delete().eq("id", id);
          await loadExams();
        }
      });
    });
  }

  // Create Exam Modal handlers
  openExamModalBtn.addEventListener("click", () => examModal.classList.remove("hidden"));
  const closeExamModal = () => examModal.classList.add("hidden");
  closeExamModalBtn.addEventListener("click", closeExamModal);
  cancelExamModalBtn.addEventListener("click", closeExamModal);

  examFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = examTitleInput.value.trim();
    const description = examDescInput.value.trim();
    const classId = examClassSelect.value;
    const duration = parseInt(examDurationInput.value) || 30;
    const passMark = parseInt(examPassMarkInput.value) || 50;
    const isPublished = examIsPublishedInput.checked;

    const { data, error } = await supabase.from("cbt_exams").insert([{
      title,
      description,
      class_id: classId,
      duration_minutes: duration,
      pass_mark: passMark,
      is_published: isPublished
    }]).select().single();

    if (error) {
      alert("Failed to create exam: " + error.message);
      return;
    }

    closeExamModal();
    examFormEl.reset();
    await loadExams();
    openQuestionsModal(data.id, data.title);
  });

  // Questions Builder Logic
  async function openQuestionsModal(examId, title) {
    currentExamId = examId;
    qModalExamTitle.textContent = title;
    qModalSubTitle.textContent = "Manage multiple choice questions for this exam.";
    questionsModal.classList.remove("hidden");
    await loadQuestions();
  }

  closeQuestionsModalBtn.addEventListener("click", () => questionsModal.classList.add("hidden"));

  async function loadQuestions() {
    questionsContainer.innerHTML = `<p class="text-xs text-slate-400 italic">Loading questions...</p>`;

    const { data: questions, error } = await supabase
      .from("cbt_questions")
      .select("*")
      .eq("exam_id", currentExamId)
      .order("created_at", { ascending: true });

    if (error) {
      questionsContainer.innerHTML = `<p class="text-xs text-red-500">Error loading questions.</p>`;
      return;
    }

    qCountDisplay.textContent = (questions || []).length;

    if (!questions || questions.length === 0) {
      questionsContainer.innerHTML = `<p class="text-xs text-slate-400 italic">No questions added yet. Use the form above to add your first question.</p>`;
      return;
    }

    questionsContainer.innerHTML = questions.map((q, idx) => {
      const opts = Array.isArray(q.options) ? q.options : [];
      const optionLabels = ["A", "B", "C", "D"];

      return `
        <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
          <div class="flex items-start justify-between gap-2">
            <h5 class="font-bold text-slate-900"><span class="text-indigo-600">Q${idx + 1}.</span> ${q.question_text}</h5>
            <button type="button" data-del-q="${q.id}" class="text-red-500 hover:text-red-700 font-bold px-1">&times;</button>
          </div>

          <div class="grid grid-cols-2 gap-2 text-[11px]">
            ${opts.map((opt, oIdx) => `
              <div class="px-2.5 py-1.5 rounded border ${oIdx === q.correct_option_index ? "bg-emerald-50 border-emerald-300 text-emerald-900 font-bold" : "bg-white border-slate-200 text-slate-700"}">
                <strong>${optionLabels[oIdx]}:</strong> ${opt}
                ${oIdx === q.correct_option_index ? " ✓" : ""}
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");

    questionsContainer.querySelectorAll("button[data-del-q]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const qId = btn.getAttribute("data-del-q");
        await supabase.from("cbt_questions").delete().eq("id", qId);
        await loadQuestions();
        await loadExams();
      });
    });
  }

  // Add Question Form submit
  addQuestionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const qText = qTextInput.value.trim();
    const options = [optA.value.trim(), optB.value.trim(), optC.value.trim(), optD.value.trim()];
    const correctIdx = parseInt(correctOptSelect.value);

    if (!qText || options.some(o => !o)) {
      alert("Please fill in question text and all 4 options.");
      return;
    }

    const { error } = await supabase.from("cbt_questions").insert([{
      exam_id: currentExamId,
      question_text: qText,
      options: options,
      correct_option_index: correctIdx,
      points: 1
    }]);

    if (error) {
      alert("Failed to save question: " + error.message);
      return;
    }

    addQuestionForm.reset();
    await loadQuestions();
    await loadExams();
  });
});
