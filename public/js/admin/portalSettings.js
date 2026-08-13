import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";

const authLoader = document.getElementById("authLoader");
const policyForm = document.getElementById("policyForm");

const restrictFeesToggle = document.getElementById("restrictFeesToggle");
const lockDueDateToggle = document.getElementById("lockDueDateToggle");
const gracePeriodDays = document.getElementById("gracePeriodDays");
const autoUnlockToggle = document.getElementById("autoUnlockToggle");
const btnSavePolicy = document.getElementById("btnSavePolicy");

let settingsRowId = null;

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    if (authLoader) authLoader.style.display = "none";

    await loadSettings();
  } catch (err) {
    console.error("Portal settings error:", err);
    alert(err?.message || "Failed to load policy settings.");
  }
}

async function loadSettings() {
  const { data } = await supabase.from("portal_access_settings").select("*").limit(1).maybeSingle();
  if (data) {
    settingsRowId = data.id;
    restrictFeesToggle.checked = Boolean(data.restrict_outstanding_fees);
    lockDueDateToggle.checked = Boolean(data.lock_after_due_date);
    gracePeriodDays.value = data.grace_period_days ?? 7;
    autoUnlockToggle.checked = Boolean(data.auto_unlock_on_full_payment);
  }
}

policyForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  btnSavePolicy.disabled = true;
  btnSavePolicy.textContent = "Saving Policy...";

  const payload = {
    restrict_outstanding_fees: restrictFeesToggle.checked,
    lock_after_due_date: lockDueDateToggle.checked,
    grace_period_days: Number(gracePeriodDays.value || 0),
    auto_unlock_on_full_payment: autoUnlockToggle.checked,
    updated_at: new Date().toISOString()
  };

  try {
    if (settingsRowId) {
      const { error } = await supabase.from("portal_access_settings").update(payload).eq("id", settingsRowId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("portal_access_settings").insert([payload]).select().single();
      if (error) throw error;
      if (data?.id) settingsRowId = data.id;
    }

    alert("Portal Access Policy settings saved successfully!");
  } catch (err) {
    alert("Failed to save settings: " + err.message);
  } finally {
    btnSavePolicy.disabled = false;
    btnSavePolicy.textContent = "Save Policy Settings";
  }
});

init();
