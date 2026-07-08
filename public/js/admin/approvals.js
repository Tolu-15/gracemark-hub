import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings } from "/js/shared/appSettings.js";
import { getClassesForDefaultSchool } from "/js/shared/schoolContext.js";

const authLoader = document.getElementById("authLoader");
const scoreTableBody = document.getElementById("scoreTableBody");
const classSelect = document.getElementById("classSelect");
const subjectSelect = document.getElementById("subjectSelect");
const btnUnlock = document.getElementById("btnUnlock");
const btnApprove = document.getElementById("btnApprove");
const saveStatus = document.getElementById("saveStatus");
const incomingQueueList = document.getElementById("incomingQueueList");
const incomingCountBadge = document.getElementById("incomingCountBadge");
const teacherSearchInput = document.getElementById("teacherSearchInput");
const teacherSearchBtn = document.getElementById("teacherSearchBtn");
const teacherSearchResults = document.getElementById("teacherSearchResults");

let currentRows = [];
let adminAuthId = null;
let currentTerm = "term1";

function renderEmpty(message) {
  scoreTableBody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-500">${message}</td></tr>`;
}

function setQueueBadge(count) {
  incomingCountBadge.textContent = `${count} pending`;
  incomingCountBadge.className =
    "px-2 py-1 text-xs font-semibold rounded " +
    (count ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600");
}

function statusBadge(status) {
  const s = String(status || "").toLowerCase();
  const styles = {
    published: "bg-amber-50 text-amber-800 ring-amber-200",
    approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    draft: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  const labels = { published: "Published", approved: "Approved", draft: "Draft" };
  const cls = styles[s] || styles.draft;
  const label = labels[s] || s;
  return `<span class="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${cls}">${label}</span>`;
}

function rowHtml(r) {
  return `
    <tr class="hover:bg-slate-50/50">
      <td class="px-6 py-4 font-medium text-slate-900 sticky left-0 bg-white border-r border-slate-100 shadow-[1px_0_0_#f1f5f9] z-10">
        <div class="leading-tight">
          <div>${r.students?.name ?? ""}</div>
          <div class="text-xs text-slate-500">${r.students?.admission_no ?? ""}</div>
        </div>
      </td>
      <td class="px-4 py-3 text-center">${r.cw ?? 0}</td>
      <td class="px-4 py-3 text-center">${r.hw ?? 0}</td>
      <td class="px-4 py-3 text-center">${r.test ?? 0}</td>
      <td class="px-4 py-3 text-center">${r.project ?? 0}</td>
      <td class="px-4 py-3 text-center">${r.exam ?? 0}</td>
      <td class="px-4 py-3 text-center font-semibold text-slate-900">${r.total ?? 0}</td>
      <td class="px-4 py-3 text-center font-bold text-emerald-700">${r.grade ?? ""}</td>
      <td class="px-4 py-3 text-center">${statusBadge(r.status)}</td>
    </tr>
  `;
}

async function populateClassOptions() {
  const classes = await getClassesForDefaultSchool();
  if (!classes.length) {
    classSelect.innerHTML = `<option value="">No classes</option>`;
    classSelect.disabled = true;
    return;
  }

  classSelect.disabled = false;
  classSelect.innerHTML = classes.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

async function populateSubjectOptions(classId) {
  if (!classId) {
    subjectSelect.innerHTML = `<option value="">Select class first</option>`;
    subjectSelect.disabled = true;
    return;
  }

  const { data, error } = await supabase
    .from("results")
    .select("subject_id, subjects(name), students!inner(class_id)")
    .eq("term", currentTerm)
    .eq("status", "published")
    .eq("students.class_id", classId);
  if (error) throw error;

  const map = new Map();
  (data ?? []).forEach((r) => map.set(r.subject_id, r.subjects?.name ?? "Subject"));

  if (!map.size) {
    subjectSelect.innerHTML = `<option value="">No published subjects</option>`;
    subjectSelect.disabled = true;
    return;
  }

  subjectSelect.disabled = false;
  subjectSelect.innerHTML = Array.from(map.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${id}">${name}</option>`)
    .join("");
}

async function loadQueue(classId) {
  if (!classId) return;

  const { data, error } = await supabase
    .from("results")
    .select("id, subject_id, subjects(name), students!inner(class_id)")
    .eq("term", currentTerm)
    .eq("status", "published")
    .eq("students.class_id", classId);
  if (error) throw error;

  const grouped = new Map(); // subject_id -> {name,count}
  (data ?? []).forEach((r) => {
    const key = r.subject_id;
    if (!grouped.has(key)) grouped.set(key, { name: r.subjects?.name ?? "Subject", count: 0 });
    grouped.get(key).count++;
  });

  const totalPending = (data ?? []).length;
  setQueueBadge(totalPending);

  if (!totalPending) {
    incomingQueueList.innerHTML = `<p class="text-sm text-slate-500">No pending published results yet.</p>`;
    return;
  }

  incomingQueueList.innerHTML = Array.from(grouped.entries())
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(
      ([subjectId, info]) => `
      <div class="flex items-center justify-between gap-3 p-3 border border-slate-200 rounded-lg bg-slate-50/60">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-slate-900 truncate">${info.name}</div>
          <div class="text-xs text-slate-500">${info.count} rows pending</div>
        </div>
        <div class="flex gap-2 shrink-0">
          <button data-action="queue-unlock" data-subject="${subjectId}" class="px-3 py-2 text-xs font-semibold border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Unlock</button>
          <button data-action="queue-approve" data-subject="${subjectId}" class="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Approve</button>
        </div>
      </div>
    `
    )
    .join("");
}

async function loadGrid({ classId, subjectId }) {
  renderEmpty("Fetching records...");
  btnApprove.disabled = true;
  btnUnlock.disabled = true;
  currentRows = [];

  if (!classId || !subjectId) {
    renderEmpty("Select a class and subject.");
    return;
  }

  const { data, error } = await supabase
    .from("results")
    .select("id, status, cw, hw, test, project, exam, total, grade, students!inner(name, admission_no, class_id)")
    .eq("term", currentTerm)
    .eq("subject_id", subjectId)
    .eq("students.class_id", classId)
    .in("status", ["published", "approved"])
    .order("students(name)", { ascending: true });
  if (error) throw error;

  currentRows = (data ?? []).sort((a, b) => {
    const admCmp = String(a.students?.admission_no ?? "").localeCompare(
      String(b.students?.admission_no ?? ""),
      undefined,
      { numeric: true, sensitivity: "base" }
    );
    if (admCmp !== 0) return admCmp;
    return String(a.students?.name ?? "").localeCompare(String(b.students?.name ?? ""), undefined, {
      sensitivity: "base",
    });
  });
  if (!currentRows.length) {
    renderEmpty("No published results found for this class/subject.");
    saveStatus.textContent = "No published records found.";
    return;
  }

  scoreTableBody.innerHTML = currentRows.map(rowHtml).join("");

  const pending = currentRows.filter((r) => r.status === "published").length;
  saveStatus.textContent = pending ? `${pending} published rows pending approval.` : "All shown rows are approved.";
  btnApprove.disabled = pending === 0;
  btnUnlock.disabled = pending === 0;
}

async function updateRowsStatus(ids, newStatus) {
  if (!ids.length) return;

  const payload =
    newStatus === "approved"
      ? { status: "approved", approved_by: adminAuthId, approved_at: new Date().toISOString() }
      : { status: "draft" };

  const { error } = await supabase.from("results").update(payload).in("id", ids);
  if (error) throw error;
}

async function processAction(newStatus) {
  btnApprove.disabled = true;
  btnUnlock.disabled = true;
  saveStatus.textContent = "Processing...";

  try {
    const ids = currentRows.filter((r) => r.status === "published").map((r) => r.id);
    await updateRowsStatus(ids, newStatus);
    alert(newStatus === "approved" ? "Approved!" : "Unlocked for edit.");
    await refresh();
  } catch (e) {
    console.error(e);
    alert("An error occurred during processing.");
  }
}

async function teacherSearch(query) {
  const q = String(query || "").trim();
  if (!q) {
    teacherSearchResults.innerHTML = `<p class="text-sm text-slate-500">Search for a teacher to unlock published subjects.</p>`;
    return;
  }

  const { data, error } = await supabase
    .from("users")
    .select("auth_id, full_name, email")
    .eq("role", "teacher")
    .ilike("full_name", `%${q}%`)
    .limit(10);
  if (error) throw error;

  if (!data?.length) {
    teacherSearchResults.innerHTML = `<p class="text-sm text-slate-500">No teachers found.</p>`;
    return;
  }

  teacherSearchResults.innerHTML = data
    .map(
      (t) => `
    <div class="flex items-center justify-between gap-3 p-3 border border-slate-200 rounded-lg bg-slate-50/60">
      <div class="min-w-0">
        <div class="text-sm font-semibold text-slate-900 truncate">${t.full_name ?? ""}</div>
        <div class="text-xs text-slate-500 truncate">${t.email ?? ""}</div>
      </div>
      <button data-action="search-unlock" data-teacher="${t.auth_id}"
        class="px-3 py-2 text-xs font-semibold border border-red-200 text-red-600 rounded-lg hover:bg-red-50 shrink-0">
        Unlock Published
      </button>
    </div>
  `
    )
    .join("");
}

async function unlockTeacherPublished(teacherId) {
  const classId = classSelect.value;
  if (!teacherId || !classId) return;

  const { data, error } = await supabase
    .from("results")
    .select("id, students!inner(class_id)")
    .eq("term", currentTerm)
    .eq("status", "published")
    .eq("submitted_by", teacherId)
    .eq("students.class_id", classId);
  if (error) throw error;

  const ids = (data ?? []).map((r) => r.id);
  await updateRowsStatus(ids, "draft");
}

async function refresh() {
  const classId = classSelect.value;
  await populateSubjectOptions(classId);
  await loadQueue(classId);
  await loadGrid({ classId, subjectId: subjectSelect.value });
}

incomingQueueList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const subjectId = btn.dataset.subject;
  if (!subjectId) return;

  btn.disabled = true;
  try {
    const classId = classSelect.value;
    const { data, error } = await supabase
      .from("results")
      .select("id, students!inner(class_id)")
      .eq("term", currentTerm)
      .eq("status", "published")
      .eq("subject_id", subjectId)
      .eq("students.class_id", classId);
    if (error) throw error;

    const ids = (data ?? []).map((r) => r.id);
    if (btn.dataset.action === "queue-approve") await updateRowsStatus(ids, "approved");
    if (btn.dataset.action === "queue-unlock") await updateRowsStatus(ids, "draft");
    await refresh();
  } catch (err) {
    console.error(err);
    alert("Failed.");
  } finally {
    btn.disabled = false;
  }
});

btnApprove.addEventListener("click", () => processAction("approved"));
btnUnlock.addEventListener("click", () => processAction("draft"));
classSelect.addEventListener("change", refresh);
subjectSelect.addEventListener("change", refresh);

teacherSearchBtn.addEventListener("click", () => teacherSearch(teacherSearchInput.value));
teacherSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    teacherSearch(teacherSearchInput.value);
  }
});

teacherSearchResults.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='search-unlock']");
  if (!btn) return;
  btn.disabled = true;
  try {
    await unlockTeacherPublished(btn.dataset.teacher);
    await refresh();
    await teacherSearch(teacherSearchInput.value);
  } catch (err) {
    console.error(err);
    alert("Failed.");
  } finally {
    btn.disabled = false;
  }
});

async function init() {
  try {
    const ok = await requireRole("admin", { redirectTo: "/" });
    if (!ok) return;

    adminAuthId = ok.session.user.id;

    const settings = await getAppSettings();
    currentTerm = settings?.current_term ?? "term1";

    await populateClassOptions();
    await refresh();
    if (authLoader) authLoader.style.display = "none";
  } catch (error) {
    console.error("Approvals init error:", error);
    if (!authLoader) {
      alert(error?.message || "Failed to verify access.");
      return;
    }

    authLoader.innerHTML = `
      <div class="text-red-500 mb-2">
        <svg class="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
      </div>
      <p class="text-sm font-medium text-slate-800 mb-4 text-center">
        Unable to verify access.<br/>Please check your connection and try again.
      </p>
      <button onclick="window.location.replace('/')" class="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm">
        Return to Login
      </button>
    `;
  }
}

init();
