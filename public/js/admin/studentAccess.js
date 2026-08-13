import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";

const authLoader = document.getElementById("authLoader");
const accessTableBody = document.getElementById("accessTableBody");

const filterClass = document.getElementById("filterClass");
const filterAccessStatus = document.getElementById("filterAccessStatus");
const searchInput = document.getElementById("searchInput");

let allStudents = [];
let loggedAdminAuthId = null;

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    loggedAdminAuthId = ok.user.id;
    if (authLoader) authLoader.style.display = "none";

    await Promise.all([loadClasses(), loadStudents()]);
  } catch (err) {
    console.error("Student access init error:", err);
    alert(err?.message || "Failed to load student portal statuses.");
  }
}

async function loadClasses() {
  const { data } = await supabase.from("classes").select("id, name").order("name");
  filterClass.innerHTML = `<option value="">All Classes</option>` +
    (data || []).map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

async function loadStudents() {
  accessTableBody.innerHTML = "";

  const { data, error } = await supabase
    .from("students")
    .select("id, name, admission_no, class_id, portal_access_status, portal_lock_reason, classes(name)")
    .order("name");

  if (error) throw error;

  allStudents = data || [];
  renderStudents();
}

function renderStudents() {
  accessTableBody.innerHTML = "";

  const q = String(searchInput.value || "").toLowerCase().trim();
  const fClass = filterClass.value;
  const fStatus = filterAccessStatus.value;

  const filtered = allStudents.filter(s => {
    if (fClass && s.class_id !== fClass) return false;
    if (fStatus && s.portal_access_status !== fStatus) return false;
    if (q) {
      const matchName = String(s.name || "").toLowerCase().includes(q);
      const matchAdm = String(s.admission_no || "").toLowerCase().includes(q);
      if (!matchName && !matchAdm) return false;
    }
    return true;
  });

  if (!filtered.length) {
    accessTableBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-500">No student portal access records found.</td></tr>`;
    return;
  }

  filtered.forEach(s => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 transition-colors";

    const isLocked = s.portal_access_status === "LOCKED";
    const statusBadge = isLocked
      ? `<span class="px-2.5 py-1 bg-rose-100 text-rose-800 font-semibold rounded text-[11px]">LOCKED</span>`
      : `<span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-semibold rounded text-[11px]">ACTIVE</span>`;

    const actionBtn = isLocked
      ? `<button class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg transition-colors shadow-sm" data-action="unlock" data-id="${s.id}">Unlock Portal</button>`
      : `<button class="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-lg transition-colors shadow-sm" data-action="lock" data-id="${s.id}">Lock Portal</button>`;

    tr.innerHTML = `
      <td class="px-5 py-3.5">
        <span class="font-bold text-slate-900 block">${s.name}</span>
        <span class="text-[11px] text-slate-400 font-mono">${s.admission_no}</span>
      </td>
      <td class="px-5 py-3.5 font-medium text-slate-700">${s.classes?.name || "Unassigned"}</td>
      <td class="px-5 py-3.5 text-center">${statusBadge}</td>
      <td class="px-5 py-3.5 text-slate-500 italic">${s.portal_lock_reason || "—"}</td>
      <td class="px-5 py-3.5 text-right">${actionBtn}</td>
    `;
    accessTableBody.appendChild(tr);
  });
}

accessTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const s = allStudents.find(item => item.id === id);
  if (!s) return;

  if (action === "lock") {
    const reason = prompt(`Enter lock reason for ${s.name}:`, "Manual admin portal restriction");
    if (reason === null) return; // cancelled

    const { error } = await supabase.from("students").update({
      portal_access_status: "LOCKED",
      portal_lock_reason: reason.trim() || "Manual admin restriction",
      portal_locked_at: new Date().toISOString(),
      portal_locked_by: loggedAdminAuthId
    }).eq("id", id);

    if (error) {
      alert("Failed to lock portal: " + error.message);
    } else {
      await supabase.from("student_portal_access_logs").insert([{
        student_id: id,
        action: "LOCKED",
        reason: reason.trim() || "Manual admin restriction",
        performed_by: loggedAdminAuthId
      }]);
      await loadStudents();
    }
  } else if (action === "unlock") {
    const { error } = await supabase.from("students").update({
      portal_access_status: "ACTIVE",
      portal_lock_reason: null
    }).eq("id", id);

    if (error) {
      alert("Failed to unlock portal: " + error.message);
    } else {
      await supabase.from("student_portal_access_logs").insert([{
        student_id: id,
        action: "UNLOCKED",
        reason: "Manual admin unlock",
        performed_by: loggedAdminAuthId
      }]);
      await loadStudents();
    }
  }
});

[searchInput, filterClass, filterAccessStatus].forEach(el => {
  el?.addEventListener("change", renderStudents);
  el?.addEventListener("input", renderStudents);
});

init();
