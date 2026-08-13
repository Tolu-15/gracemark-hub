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
    supabase.from("students").select("id", { count: "exact", head: true }).eq("portal_access_status", "LOCKED"),
    supabase.from("payment_invoices").select("total_amount, amount_paid")
  ]).then((results) => results.map((r) => {
    if (r.error) throw r.error;
    return r;
  }));

  totalStudentsStat.textContent = String(studentsCount ?? 0);
  activeClassesStat.textContent = String(classesCount ?? 0);
  totalTeachersStat.textContent = String(teachersCount ?? 0);

  const lockedCount = lockedRes?.count ?? 0;
  const invs = invoicesRes?.data || [];
  const totalExp = invs.reduce((sum, i) => sum + Number(i.total_amount || 0), 0);
  const totalColl = invs.reduce((sum, i) => sum + Number(i.amount_paid || 0), 0);
  const totalOut = Math.max(0, totalExp - totalColl);

  const dashExpectedStat = document.getElementById("dashExpectedStat");
  const dashCollectedStat = document.getElementById("dashCollectedStat");
  const dashOutstandingStat = document.getElementById("dashOutstandingStat");
  const dashLockedPortalsStat = document.getElementById("dashLockedPortalsStat");

  if (dashExpectedStat) dashExpectedStat.textContent = "₦" + totalExp.toLocaleString("en-NG", { minimumFractionDigits: 2 });
  if (dashCollectedStat) dashCollectedStat.textContent = "₦" + totalColl.toLocaleString("en-NG", { minimumFractionDigits: 2 });
  if (dashOutstandingStat) dashOutstandingStat.textContent = "₦" + totalOut.toLocaleString("en-NG", { minimumFractionDigits: 2 });
  if (dashLockedPortalsStat) dashLockedPortalsStat.textContent = String(lockedCount);
}

const btnToggleNewSession = document.getElementById("btnToggleNewSession");
const customSessionInput = document.getElementById("customSessionInput");

btnToggleNewSession?.addEventListener("click", () => {
  if (customSessionInput.classList.contains("hidden")) {
    customSessionInput.classList.remove("hidden");
    customSessionInput.focus();
    btnToggleNewSession.textContent = "Cancel";
  } else {
    customSessionInput.classList.add("hidden");
    customSessionInput.value = "";
    btnToggleNewSession.textContent = "+ Create New";
  }
});

async function loadSettings() {
  if (!globalTerm || !globalSession) return;
  const settings = await getAppSettings();
  if (!settings) return;

  globalTerm.value = termDbToUi(settings.current_term);
  if (settings.current_session) {
    // Check if session exists in options, else create option
    let opt = Array.from(globalSession.options).find(o => o.value === settings.current_session);
    if (!opt) {
      opt = document.createElement("option");
      opt.value = settings.current_session;
      opt.textContent = settings.current_session;
      globalSession.appendChild(opt);
    }
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
    let sessionToSave = globalSession.value;

    if (!customSessionInput.classList.contains("hidden") && customSessionInput.value.trim()) {
      sessionToSave = customSessionInput.value.trim();
      let opt = Array.from(globalSession.options).find(o => o.value === sessionToSave);
      if (!opt) {
        opt = document.createElement("option");
        opt.value = sessionToSave;
        opt.textContent = sessionToSave;
        globalSession.appendChild(opt);
      }
      globalSession.value = sessionToSave;
      customSessionInput.classList.add("hidden");
      customSessionInput.value = "";
      btnToggleNewSession.textContent = "+ Create New";
    }

    await setAppSettings({
      current_term: termUiToDb(globalTerm.value),
      current_session: sessionToSave,
    });
    alert(`Global academic settings updated! Active Session is now: ${sessionToSave}`);
  } catch (error) {
    console.error("Error saving global settings:", error);
    alert("Failed to save global settings. " + error.message);
  } finally {
    saveGlobalSettingsBtn.textContent = "Save Settings";
    saveGlobalSettingsBtn.disabled = false;
  }
});

init();
