import { requireRole } from "/js/shared/guard.js";
import { signOut } from "/js/shared/auth.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings, setAppSettings } from "/js/admin/crud.js";

const authLoader = document.getElementById("authLoader");
const adminNameDisplay = document.getElementById("adminName");
const logoutBtn = document.getElementById("logoutBtn");

const globalTerm = document.getElementById("globalTerm");
const globalSession = document.getElementById("globalSession");
const saveGlobalSettingsBtn = document.getElementById("saveGlobalSettingsBtn");

const totalStudentsStat = document.getElementById("totalStudentsStat");
const totalTeachersStat = document.getElementById("totalTeachersStat");
const activeClassesStat = document.getElementById("activeClassesStat");

function termDbToUi(term) {
  if (term === "term1") return "1st Term";
  if (term === "term2") return "2nd Term";
  if (term === "term3") return "3rd Term";
  return "1st Term";
}

function termUiToDb(term) {
  if (term === "1st Term") return "term1";
  if (term === "2nd Term") return "term2";
  if (term === "3rd Term") return "term3";
  return "term1";
}

async function loadStats() {
  const [{ count: studentsCount }, { count: classesCount }, { count: teachersCount }] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }),
    supabase.from("classes").select("id", { count: "exact", head: true }),
    supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "teacher"),
  ]).then((results) => results.map((r) => {
    if (r.error) throw r.error;
    return r;
  }));

  totalStudentsStat.textContent = String(studentsCount ?? 0);
  activeClassesStat.textContent = String(classesCount ?? 0);
  totalTeachersStat.textContent = String(teachersCount ?? 0);
}

async function loadSettings() {
  if (!globalTerm || !globalSession) return;
  const settings = await getAppSettings();
  if (!settings) return;

  globalTerm.value = termDbToUi(settings.current_term);
  if (settings.current_session) {
    globalSession.value = settings.current_session;
  }
}

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    adminNameDisplay.textContent = ok.profile.display_name || "Administrator";
    authLoader.style.display = "none";

    await Promise.all([loadStats(), loadSettings()]);
  } catch (error) {
    console.error("Admin init error:", error);
    authLoader.innerHTML = `
      <div class="text-red-500 mb-2">
        <svg class="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
      </div>
      <p class="text-sm font-medium text-slate-800 mb-4 text-center">
        Cannot connect to the database.<br/>Please check your connection.
      </p>
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

saveGlobalSettingsBtn?.addEventListener("click", async () => {
  saveGlobalSettingsBtn.textContent = "Saving...";
  saveGlobalSettingsBtn.disabled = true;
  try {
    await setAppSettings({
      current_term: termUiToDb(globalTerm.value),
      current_session: globalSession.value,
    });
    alert("Global academic settings successfully updated!");
  } catch (error) {
    console.error("Error saving global settings:", error);
    alert("Failed to save global settings.");
  } finally {
    saveGlobalSettingsBtn.textContent = "Save Settings";
    saveGlobalSettingsBtn.disabled = false;
  }
});

init();
