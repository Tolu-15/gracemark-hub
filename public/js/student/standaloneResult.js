import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getLatestAppSettings } from "/js/shared/appSettings.js";
import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import { ResultDashboardApp } from "/js/student/resultDashboard/ResultDashboardApp.js";

const authLoader = document.getElementById("authLoader");
const rootContainer = document.getElementById("standaloneResultRoot");

async function init() {
  try {
    const ok = await requireRole("student", { redirectTo: "/" });
    if (!ok) return;

    const { data: student, error: studentErr } = await supabase
      .from("students")
      .select("id, admission_no, name, class_id, classes(name)")
      .eq("user_id", ok.session.user.id)
      .maybeSingle();

    if (studentErr) throw studentErr;
    if (!student) {
      throw new Error("Student profile not found. Please contact administration.");
    }

    const settings = await getLatestAppSettings();
    const currentTerm = settings?.current_term || "term1";
    const currentSession = settings?.current_session || "2025/2026";

    authLoader.style.display = "none";

    const reactRoot = createRoot(rootContainer);
    reactRoot.render(
      React.createElement(ResultDashboardApp, {
        student,
        initialTerm: currentTerm,
        initialSession: currentSession,
        onClose: () => {
          window.location.href = "/student/dashboard/";
        },
      })
    );
  } catch (err) {
    console.error("Standalone result error:", err);
    if (authLoader) {
      authLoader.innerHTML = `
        <div class="text-center p-6 max-w-md">
          <p class="text-rose-600 font-semibold mb-3">${err.message || "Failed to load report sheet."}</p>
          <a href="/student/dashboard/" class="inline-block px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors">
            Return to Dashboard
          </a>
        </div>
      `;
    }
  }
}

init();
