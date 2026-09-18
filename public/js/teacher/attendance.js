import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings } from "/js/shared/appSettings.js";
import { getClassByName } from "/js/shared/schoolContext.js";

const classSelect = document.getElementById("classSelect");
const datePicker = document.getElementById("datePicker");
const displayTerm = document.getElementById("displayTerm");
const attendanceTableBody = document.getElementById("attendanceTableBody");
const btnMarkAllPresent = document.getElementById("btnMarkAllPresent");
const btnResetDay = document.getElementById("btnResetDay");
const btnSaveAttendance = document.getElementById("btnSaveAttendance");
const saveStatus = document.getElementById("saveStatus");

const statClassSize = document.getElementById("statClassSize");
const statAmPresent = document.getElementById("statAmPresent");
const statPmPresent = document.getElementById("statPmPresent");
const statTermOpened = document.getElementById("statTermOpened");

let currentStudents = [];
let attendanceState = new Map(); // studentId -> { am: boolean, pm: boolean, termPresent: number, termOpened: number }
let currentTerm = "term1";
let currentSession = "2025/2026";
let currentTeacherId = null;

function termLabel(term) {
  if (term === "term1") return "1st Term";
  if (term === "term2") return "2nd Term";
  if (term === "term3") return "3rd Term";
  return term || "—";
}

function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function loadTeacherClasses(teacherAuthId) {
  // Query classes assigned to teacher
  const { data: assignments, error } = await supabase
    .from("teacher_assignments")
    .select("class_id, classes(id, name)")
    .eq("teacher_user_id", teacherAuthId);

  let classList = [];
  if (!error && assignments?.length) {
    const seen = new Set();
    assignments.forEach((a) => {
      if (a.classes?.name && !seen.has(a.classes.name)) {
        seen.add(a.classes.name);
        classList.push(a.classes.name);
      }
    });
  }

  // Fallback: If no explicit assignments found, fetch all classes
  if (!classList.length) {
    const { data: allClasses } = await supabase.from("classes").select("name").order("name");
    classList = (allClasses || []).map((c) => c.name);
  }

  classList.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  classSelect.innerHTML = classList.map((c) => `<option value="${c}">${c}</option>`).join("");
  classSelect.disabled = classList.length === 0;
  return classList;
}

async function fetchClassStudents(className) {
  const cls = await getClassByName(className);
  if (!cls?.id) return [];

  const { data, error } = await supabase
    .from("students")
    .select("id, name, admission_no")
    .eq("class_id", cls.id)
    .order("admission_no", { ascending: true });

  if (error) {
    console.error("Error fetching students:", error);
    return [];
  }
  return data ?? [];
}

async function loadAttendanceData(className, selectedDate) {
  currentStudents = await fetchClassStudents(className);
  statClassSize.textContent = String(currentStudents.length);

  if (!currentStudents.length) {
    attendanceTableBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-500">No students found in ${className}.</td></tr>`;
    updateStats();
    return;
  }

  const studentIds = currentStudents.map((s) => s.id);

  // 1. Fetch term-level attendance totals
  let termAttendanceMap = new Map();
  try {
    const { data: termData } = await supabase
      .from("attendance")
      .select("student_id, times_opened, times_present, times_absent, days_present, days_absent")
      .in("student_id", studentIds)
      .eq("term", currentTerm);

    (termData || []).forEach((r) => {
      const opened = r.times_opened || ((r.days_present || 0) + (r.days_absent || 0)) * 2 || 130;
      const present = r.times_present || (r.days_present ? r.days_present * 2 : 0);
      termAttendanceMap.set(r.student_id, { opened, present });
    });
  } catch (err) {
    console.warn("Term attendance query notice:", err);
  }

  // 2. Fetch daily record for selected date if available
  let dailyMap = new Map();
  try {
    const { data: dailyData } = await supabase
      .from("attendance_records")
      .select("student_id, am_present, pm_present")
      .in("student_id", studentIds)
      .eq("date", selectedDate)
      .eq("term", currentTerm);

    (dailyData || []).forEach((r) => {
      dailyMap.set(r.student_id, { am: Boolean(r.am_present), pm: Boolean(r.pm_present) });
    });
  } catch (_) {}

  // Initialize state
  attendanceState.clear();
  currentStudents.forEach((s) => {
    const daily = dailyMap.get(s.id) || { am: true, pm: true };
    const termStat = termAttendanceMap.get(s.id) || { opened: 130, present: 0 };
    attendanceState.set(s.id, {
      am: daily.am,
      pm: daily.pm,
      termPresent: termStat.present,
      termOpened: termStat.opened,
    });
  });

  renderRows();
  updateStats();
}

function renderRows() {
  attendanceTableBody.innerHTML = "";

  currentStudents.forEach((student, idx) => {
    const state = attendanceState.get(student.id) || { am: true, pm: true, termPresent: 0, termOpened: 130 };
    const dayTotal = (state.am ? 1 : 0) + (state.pm ? 1 : 0);
    const ratePct = state.termOpened > 0 ? Math.round((state.termPresent / state.termOpened) * 100) : 100;

    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/50 transition-colors";
    tr.dataset.studentId = student.id;

    tr.innerHTML = `
      <td class="p-3 text-center text-slate-400 font-mono text-xs border-r border-slate-200">${idx + 1}</td>
      <td class="p-3 font-medium text-slate-900 border-r border-slate-200">
        <div>${student.name ?? "—"}</div>
      </td>
      <td class="p-3 text-center text-slate-500 font-mono text-xs border-r border-slate-200">
        ${student.admission_no ?? "—"}
      </td>
      <td class="p-2.5 text-center border-r border-slate-200 bg-amber-50/20">
        <button type="button" data-field="am" class="attendance-toggle px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 ${
          state.am ? "is-present" : "is-absent"
        }">
          <span>${state.am ? "✓ Present" : "✕ Absent"}</span>
        </button>
      </td>
      <td class="p-2.5 text-center border-r border-slate-200 bg-indigo-50/20">
        <button type="button" data-field="pm" class="attendance-toggle px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 ${
          state.pm ? "is-present" : "is-absent"
        }">
          <span>${state.pm ? "✓ Present" : "✕ Absent"}</span>
        </button>
      </td>
      <td class="p-3 text-center font-bold text-slate-700 border-r border-slate-200" data-out="dayTotal">
        ${dayTotal} / 2
      </td>
      <td class="p-3 text-center font-semibold text-slate-900 border-r border-slate-200">
        <input type="number" min="0" max="${state.termOpened}" value="${state.termPresent}" 
          class="w-16 px-2 py-1 border border-slate-300 rounded text-center text-xs font-semibold focus:border-blue-500" 
          data-field="termPresentInput" />
        <span class="text-xs text-slate-400">/ ${state.termOpened}</span>
      </td>
      <td class="p-3 text-center font-bold" data-out="ratePct">
        <span class="px-2 py-0.5 rounded text-xs ${
          ratePct >= 80 ? "bg-emerald-100 text-emerald-800" : ratePct >= 65 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"
        }">
          ${ratePct}%
        </span>
      </td>
    `;

    attendanceTableBody.appendChild(tr);
  });
}

function updateStats() {
  let amCount = 0;
  let pmCount = 0;
  attendanceState.forEach((val) => {
    if (val.am) amCount++;
    if (val.pm) pmCount++;
  });
  statAmPresent.textContent = String(amCount);
  statPmPresent.textContent = String(pmCount);
}

function handleTableClick(e) {
  const btn = e.target.closest("button[data-field]");
  if (!btn) return;

  const tr = btn.closest("tr[data-student-id]");
  if (!tr) return;

  const studentId = tr.dataset.studentId;
  const field = btn.dataset.field; // "am" or "pm"
  const state = attendanceState.get(studentId);
  if (!state) return;

  // Toggle
  state[field] = !state[field];

  btn.className = `attendance-toggle px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 ${
    state[field] ? "is-present" : "is-absent"
  }`;
  btn.innerHTML = `<span>${state[field] ? "✓ Present" : "✕ Absent"}</span>`;

  const dayTotal = (state.am ? 1 : 0) + (state.pm ? 1 : 0);
  tr.querySelector('[data-out="dayTotal"]').textContent = `${dayTotal} / 2`;

  updateStats();
  saveStatus.textContent = "Unsaved changes in attendance…";
}

function handleTableInput(e) {
  const input = e.target.closest("input[data-field='termPresentInput']");
  if (!input) return;

  const tr = input.closest("tr[data-student-id]");
  if (!tr) return;

  const studentId = tr.dataset.studentId;
  const state = attendanceState.get(studentId);
  if (!state) return;

  const val = Math.max(0, Math.min(state.termOpened, Number(input.value) || 0));
  state.termPresent = val;
  const ratePct = state.termOpened > 0 ? Math.round((val / state.termOpened) * 100) : 100;

  const rateCell = tr.querySelector('[data-out="ratePct"]');
  rateCell.innerHTML = `
    <span class="px-2 py-0.5 rounded text-xs ${
      ratePct >= 80 ? "bg-emerald-100 text-emerald-800" : ratePct >= 65 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"
    }">
      ${ratePct}%
    </span>
  `;

  saveStatus.textContent = "Unsaved changes in attendance…";
}

async function saveAttendanceRecords() {
  if (!currentStudents.length) return;
  const className = classSelect.value;
  const selectedDate = datePicker.value || getTodayString();
  const cls = await getClassByName(className);

  btnSaveAttendance.disabled = true;
  saveStatus.textContent = "Saving attendance records...";

  try {
    // 1. Prepare daily records
    const dailyPayload = currentStudents.map((s) => {
      const state = attendanceState.get(s.id) || { am: true, pm: true };
      return {
        student_id: s.id,
        class_id: cls?.id || null,
        term: currentTerm,
        session: currentSession,
        date: selectedDate,
        am_present: state.am,
        pm_present: state.pm,
        recorded_by: currentTeacherId,
      };
    });

    try {
      await supabase.from("attendance_records").upsert(dailyPayload, { onConflict: "student_id,term,session,date" });
    } catch (e) {
      console.warn("attendance_records table not found or error:", e);
    }

    // 2. Prepare term cumulative records
    const termPayload = currentStudents.map((s) => {
      const state = attendanceState.get(s.id) || { am: true, pm: true, termPresent: 0, termOpened: 130 };
      const timesOpened = state.termOpened || 130;
      const timesPresent = state.termPresent;
      const timesAbsent = Math.max(0, timesOpened - timesPresent);

      return {
        student_id: s.id,
        class_id: cls?.id || null,
        session: currentSession,
        term: currentTerm,
        times_opened: timesOpened,
        times_present: timesPresent,
        times_absent: timesAbsent,
        days_present: Math.round(timesPresent / 2),
        days_absent: Math.round(timesAbsent / 2),
        recorded_by: currentTeacherId,
        updated_at: new Date().toISOString(),
      };
    });

    let { error: termErr } = await supabase
      .from("attendance")
      .upsert(termPayload, { onConflict: "student_id,term" });

    if (termErr && /times_opened|session/i.test(termErr.message || "")) {
      // Fallback for legacy columns only
      const fallbackPayload = termPayload.map(({ student_id, term, days_present, days_absent }) => ({
        student_id,
        term,
        days_present,
        days_absent,
      }));
      ({ error: termErr } = await supabase
        .from("attendance")
        .upsert(fallbackPayload, { onConflict: "student_id,term" }));
    }

    if (termErr) throw termErr;

    saveStatus.textContent = `✓ Attendance successfully saved for ${selectedDate}`;
    saveStatus.classList.add("text-emerald-600");
  } catch (err) {
    console.error("Save attendance error:", err);
    saveStatus.textContent = `Error saving: ${err?.message || "Failed"}`;
    saveStatus.classList.add("text-red-600");
    alert("Could not save attendance: " + (err?.message || "Please check database connection"));
  } finally {
    btnSaveAttendance.disabled = false;
  }
}

export async function initAttendanceRegister() {
  const ok = await requireRole("teacher", { redirectTo: "/" });
  if (!ok) return;

  currentTeacherId = ok.session.user.id;

  const settings = await getAppSettings();
  currentTerm = settings?.current_term || "term1";
  currentSession = settings?.current_session || "2025/2026";

  if (displayTerm) displayTerm.textContent = termLabel(currentTerm);

  datePicker.value = getTodayString();

  const classes = await loadTeacherClasses(currentTeacherId);
  if (classes.length > 0) {
    await loadAttendanceData(classes[0], datePicker.value);
  }

  classSelect.addEventListener("change", async () => {
    await loadAttendanceData(classSelect.value, datePicker.value);
  });

  datePicker.addEventListener("change", async () => {
    await loadAttendanceData(classSelect.value, datePicker.value);
  });

  attendanceTableBody.addEventListener("click", handleTableClick);
  attendanceTableBody.addEventListener("input", handleTableInput);

  btnMarkAllPresent?.addEventListener("click", () => {
    attendanceState.forEach((val) => {
      val.am = true;
      val.pm = true;
    });
    renderRows();
    updateStats();
    saveStatus.textContent = "Marked all present for this day (unsaved).";
  });

  btnResetDay?.addEventListener("click", () => {
    attendanceState.forEach((val) => {
      val.am = false;
      val.pm = false;
    });
    renderRows();
    updateStats();
    saveStatus.textContent = "Cleared all for this day (unsaved).";
  });

  btnSaveAttendance?.addEventListener("click", saveAttendanceRecords);
}

initAttendanceRegister().catch((e) => {
  console.error("Attendance initialization error:", e);
});
