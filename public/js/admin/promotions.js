import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings } from "/js/shared/appSettings.js";
import { ensureClassByName } from "/js/shared/schoolContext.js";

const authLoader = document.getElementById("authLoader");
const logoutBtn = document.getElementById("logoutBtn");
const currentSessionBanner = document.getElementById("currentSessionBanner");
const currentTermBanner = document.getElementById("currentTermBanner");
const promotionPreviewBody = document.getElementById("promotionPreviewBody");
const totalStudentsCount = document.getElementById("totalStudentsCount");
const promotionHistoryList = document.getElementById("promotionHistoryList");

// Modal buttons
const btnStartPromotion = document.getElementById("btnStartPromotion");
const confirmModal = document.getElementById("confirmModal");
const confirmStudentCount = document.getElementById("confirmStudentCount");
const promotionNotes = document.getElementById("promotionNotes");
const cancelConfirmBtn = document.getElementById("cancelConfirmBtn");
const confirmPromoteBtn = document.getElementById("confirmPromoteBtn");

let adminUser = null;
let currentSession = "";
let currentTerm = "";
let classList = [];
let studentCountMap = new Map(); // class_id -> count
let classMap = new Map(); // name -> class_record
let allStudentsList = []; // Array of all active students

// Determines the next class name logically
function getNextClassLogical(className) {
  const name = String(className || "").trim().toUpperCase();
  if (name.includes("JSS 1")) return name.replace("JSS 1", "JSS 2");
  if (name.includes("JSS 2")) return name.replace("JSS 2", "JSS 3");
  if (name.includes("JSS 3")) return "SSS 1"; // JSS 3 students promote to general SSS 1 first
  if (name.includes("SSS 1")) return name.replace("SSS 1", "SSS 2");
  if (name.includes("SSS 2")) return name.replace("SSS 2", "SSS 3");
  if (name.includes("SSS 3")) return "ALUMNI (GRADUATED)";
  return "STAYS IN CLASS (CUSTOM)";
}

async function loadPromotionsData() {
  try {
    // 1. Fetch current session & term
    const settings = await getAppSettings();
    currentSession = settings?.current_session || "—";
    currentTerm = settings?.current_term || "term1";

    currentSessionBanner.textContent = currentSession;
    currentTermBanner.textContent = currentTerm === "term3" 
      ? "3rd Term (End of Session — Promotion Ready)" 
      : `${currentTerm === "term1" ? "1st Term" : "2nd Term"} (Promotion usually at End of Session)`;

    // 2. Fetch all classes
    const { data: classes, error: clErr } = await supabase
      .from("classes")
      .select("*")
      .order("name", { ascending: true });
    if (clErr) throw clErr;
    classList = classes || [];
    classMap.clear();
    classList.forEach((c) => classMap.set(c.name.trim().toUpperCase(), c));

    // 3. Fetch all active students
    const { data: students, error: stdErr } = await supabase
      .from("students")
      .select("id, name, admission_no, class_id, classes(name)")
      .eq("is_alumni", false);
    if (stdErr) throw stdErr;

    allStudentsList = students || [];
    totalStudentsCount.textContent = `${allStudentsList.length} active students`;

    // Aggregate counts
    studentCountMap.clear();
    allStudentsList.forEach((s) => {
      studentCountMap.set(s.class_id, (studentCountMap.get(s.class_id) || 0) + 1);
    });

    renderPreview();
    await loadHistory();
  } catch (error) {
    console.error("Load promotions error:", error);
    alert("Failed to load promotion data: " + error.message);
  }
}

function renderPreview() {
  if (!classList.length) {
    promotionPreviewBody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-slate-500">No classes found in schema.</td></tr>`;
    return;
  }

  promotionPreviewBody.innerHTML = classList.map((c) => {
    const nextName = getNextClassLogical(c.name);
    const count = studentCountMap.get(c.id) || 0;
    
    let statusText = `<span class="text-indigo-600 font-semibold">Ready to promote</span>`;
    if (count === 0) statusText = `<span class="text-slate-400">Empty class</span>`;
    if (nextName === "STAYS IN CLASS (CUSTOM)") statusText = `<span class="text-slate-400">Custom class (Ignored)</span>`;

    return `
      <tr class="hover:bg-slate-50/50 border-b border-slate-100">
        <td class="px-6 py-4 font-semibold text-slate-900">${c.name}</td>
        <td class="px-6 py-4 font-medium text-slate-700">${count} students</td>
        <td class="px-6 py-4 font-semibold text-indigo-700">${nextName}</td>
        <td class="px-6 py-4">${statusText}</td>
      </tr>
    `;
  }).join("");
}

async function loadHistory() {
  const { data: history, error } = await supabase
    .from("promotions")
    .select("id, session, promoted_at, summary, notes")
    .order("promoted_at", { ascending: false });

  if (error) {
    console.error(error);
    promotionHistoryList.innerHTML = `<p class="text-sm text-red-500 py-4 text-center">Failed to load history.</p>`;
    return;
  }

  if (!history?.length) {
    promotionHistoryList.innerHTML = `<p class="text-sm text-slate-500 py-4 text-center">No past promotions logged yet.</p>`;
    return;
  }

  promotionHistoryList.innerHTML = history.map((h) => {
    const count = Array.isArray(h.summary) ? h.summary.length : 0;
    const date = new Date(h.promoted_at).toLocaleString();
    return `
      <div class="p-4 border border-slate-200 rounded-lg bg-slate-50/60 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div class="text-sm font-bold text-slate-800">Session Completed: ${h.session}</div>
          <div class="text-xs text-slate-500 mt-0.5">Promoted on ${date} · Notes: ${h.notes || "None"}</div>
        </div>
        <div class="text-xs font-semibold bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg shrink-0">
          ${count} students promoted / graduated
        </div>
      </div>
    `;
  }).join("");
}

async function executePromotions() {
  confirmPromoteBtn.disabled = true;
  confirmPromoteBtn.textContent = "Processing...";

  try {
    const summary = [];
    const notesVal = promotionNotes.value.trim();

    // Loop students and logically update
    for (const student of allStudentsList) {
      const currentClassName = student.classes?.name || "";
      const nextClassName = getNextClassLogical(currentClassName);

      if (nextClassName === "ALUMNI (GRADUATED)") {
        // 1. Mark as alumni
        const { error: updErr } = await supabase
          .from("students")
          .update({ is_alumni: true })
          .eq("id", student.id);
        if (updErr) throw updErr;

        summary.push({
          student_id: student.id,
          name: student.name,
          from_class: currentClassName,
          to_class: "Alumni",
          graduated: true,
        });
      } else if (nextClassName !== "STAYS IN CLASS (CUSTOM)") {
        // 2. Promote to next class
        // Check if next class exists in classMap or database
        let targetClass = classMap.get(nextClassName.toUpperCase());
        if (!targetClass) {
          // Auto create class if missing
          targetClass = await ensureClassByName(nextClassName);
          classMap.set(nextClassName.toUpperCase(), targetClass);
        }

        const { error: updErr } = await supabase
          .from("students")
          .update({ class_id: targetClass.id })
          .eq("id", student.id);
        if (updErr) throw updErr;

        summary.push({
          student_id: student.id,
          name: student.name,
          from_class: currentClassName,
          to_class: nextClassName,
          graduated: false,
        });
      }
    }

    // 3. Log to promotions table
    const { data: promotionRow, error: logErr } = await supabase
      .from("promotions")
      .insert({
        session: currentSession,
        promoted_by: adminUser.id,
        summary,
        notes: notesVal,
      })
      .select("id")
      .single();
    if (logErr) throw logErr;

    // 4. Log alumni entries
    const alumniRecords = summary.filter((s) => s.graduated).map((s) => ({
      student_id: s.student_id,
      graduated_session: currentSession,
      promotion_id: promotionRow.id,
    }));

    if (alumniRecords.length) {
      const { error: alErr } = await supabase
        .from("alumni_students")
        .insert(alumniRecords);
      if (alErr) throw alErr;
    }

    alert("Academic student promotions executed successfully!");
    confirmModal.classList.add("hidden");
    promotionNotes.value = "";
    await loadPromotionsData();
  } catch (error) {
    console.error("Promotion execution failed:", error);
    alert("Failed to promote: " + error.message);
  } finally {
    confirmPromoteBtn.disabled = false;
    confirmPromoteBtn.textContent = "Promote Students";
  }
}

btnStartPromotion.addEventListener("click", () => {
  const count = allStudentsList.filter((s) => {
    const next = getNextClassLogical(s.classes?.name);
    return next !== "STAYS IN CLASS (CUSTOM)";
  }).length;

  if (count === 0) {
    alert("No active students are currently eligible for promotion.");
    return;
  }

  confirmStudentCount.textContent = count;
  confirmModal.classList.remove("hidden");
});

cancelConfirmBtn.addEventListener("click", () => confirmModal.classList.add("hidden"));
confirmPromoteBtn.addEventListener("click", executePromotions);

logoutBtn?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.replace("/");
});

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    adminUser = ok.session.user;
    authLoader.style.display = "none";
    await loadPromotionsData();
  } catch (error) {
    console.error("Promotions init error:", error);
    authLoader.innerHTML = `
      <div class="text-red-500 mb-2">
        <svg class="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
      </div>
      <p class="text-sm font-medium text-slate-800 mb-4 text-center">Cannot verify access. Please check your connection.</p>
      <button onclick="window.location.replace('/')" class="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm">Return to Login</button>
    `;
  }
}

init();
