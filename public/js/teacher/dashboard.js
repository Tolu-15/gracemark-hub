import { requireRole } from "/js/shared/guard.js";
import { signOut } from "/js/shared/auth.js";
import { supabase } from "/js/shared/supabaseClient.js";

const authLoader = document.getElementById("authLoader");
const logoutBtn = document.getElementById("logoutBtn");
const teacherName = document.getElementById("teacherName");
const displayAssignments = document.getElementById("displayAssignments");

function pill(text) {
  const span = document.createElement("span");
  span.className =
    "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100";
  span.textContent = text;
  return span;
}

async function loadAssignments() {
  if (!displayAssignments) return;
  displayAssignments.textContent = "";

  const { data, error } = await supabase
    .from("teacher_assignments")
    .select("class_id, subject_id, classes(name), subjects(name)");

  if (error) throw error;

  if (!data?.length) {
    displayAssignments.textContent = "No assignments yet.";
    return;
  }

  data.forEach((row) => {
    const cls = row.classes?.name ?? "Class";
    const sub = row.subjects?.name ?? "Subject";
    displayAssignments.appendChild(pill(`${cls} • ${sub}`));
  });
}

async function init() {
  try {
    const ok = await requireRole("teacher", { redirectTo: "/" });
    if (!ok) return;

    teacherName.textContent = ok.profile.full_name || "Teacher";
    await loadAssignments();
    authLoader.style.display = "none";
  } catch (error) {
    console.error("Teacher init error:", error);
    authLoader.innerHTML = `
      <p class="text-sm font-medium text-slate-800 mb-2 text-center">Cannot connect to the database.</p>
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

init();

