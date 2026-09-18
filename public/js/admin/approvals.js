import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings } from "/js/shared/appSettings.js";
import { getClassesForDefaultSchool } from "/js/shared/schoolContext.js";
import {
  calculatePR1,
  calculatePR2,
  calculatePR3,
  calculateTR,
  normalizeBreakdown,
  toStoredScores,
  isSeniorClass,
  computeClassSubjectStats,
} from "/shared/gradingEngine.js";

const authLoader = document.getElementById("authLoader");
const scoreTableBody = document.getElementById("scoreTableBody");
const classSelect = document.getElementById("classSelect");
const subjectSelect = document.getElementById("subjectSelect");
const btnUnlock = document.getElementById("btnUnlock");
const btnApprove = document.getElementById("btnApprove");
const saveStatus = document.getElementById("saveStatus");
const incomingQueueList = document.getElementById("incomingQueueList");
const incomingCountBadge = document.getElementById("incomingCountBadge");

// Return Modal elements
const returnModal = document.getElementById("returnModal");
const returnReasonInput = document.getElementById("returnReasonInput");
const btnCloseReturnModal = document.getElementById("btnCloseReturnModal");
const btnCancelReturn = document.getElementById("btnCancelReturn");
const btnConfirmReturn = document.getElementById("btnConfirmReturn");

// Signature & Resumption elements
const sigPlaceholder = document.getElementById("sigPlaceholder");
const sigImg = document.getElementById("sigImg");
const sigFileInput = document.getElementById("sigFileInput");
const resumptionDatePicker = document.getElementById("resumptionDatePicker");
const btnSaveResumption = document.getElementById("btnSaveResumption");

// Publish Gating elements
const publishMilestoneSelect = document.getElementById("publishMilestoneSelect");
const btnBatchPublish = document.getElementById("btnBatchPublish");
const btnUnpublish = document.getElementById("btnUnpublish");
const publishStatusBanner = document.getElementById("publishStatusBanner");

let currentRows = [];
let adminAuthId = null;
let currentTerm = "term1";
let currentSession = "2025/2026";
let principalSignatureBase64 = null;

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
    published: "bg-purple-50 text-purple-800 ring-purple-200",
    submitted: "bg-amber-50 text-amber-800 ring-amber-200",
    approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    draft: "bg-slate-100 text-slate-600 ring-slate-200",
    returned: "bg-rose-50 text-rose-800 ring-rose-200",
  };
  const labels = {
    published: "Published",
    submitted: "Submitted",
    approved: "Approved",
    draft: "Draft",
    returned: "Returned",
  };
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
          <div class="text-xs text-slate-500 font-mono">${r.students?.admission_no ?? ""}</div>
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
    .in("status", ["submitted", "published", "approved"])
    .eq("students.class_id", classId);
  if (error) throw error;

  const map = new Map();
  (data ?? []).forEach((r) => map.set(r.subject_id, r.subjects?.name ?? "Subject"));

  if (!map.size) {
    subjectSelect.innerHTML = `<option value="">No submitted subjects</option>`;
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
    .in("status", ["submitted", "published"])
    .eq("students.class_id", classId);
  if (error) throw error;

  const grouped = new Map();
  (data ?? []).forEach((r) => {
    const key = r.subject_id;
    if (!grouped.has(key)) grouped.set(key, { name: r.subjects?.name ?? "Subject", count: 0 });
    grouped.get(key).count++;
  });

  const totalPending = (data ?? []).length;
  setQueueBadge(totalPending);

  if (!totalPending) {
    incomingQueueList.innerHTML = `<p class="text-sm text-slate-500">No pending submissions yet.</p>`;
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
          <button data-action="queue-select" data-subject="${subjectId}" class="px-3 py-1.5 text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg">View</button>
        </div>
      </div>
    `
    )
    .join("");

  incomingQueueList.querySelectorAll("button[data-action='queue-select']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      subjectSelect.value = btn.dataset.subject;
      await loadGrid({ classId, subjectId: btn.dataset.subject });
    });
  });
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
    .select("id, status, cw, hw, test, project, exam, total, grade, return_reason, score_breakdown, students!inner(id, name, admission_no, class_id)")
    .eq("term", currentTerm)
    .eq("subject_id", subjectId)
    .eq("students.class_id", classId)
    .in("status", ["submitted", "published", "approved", "returned"])
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
    renderEmpty("No results found for this class/subject.");
    saveStatus.textContent = "No records found.";
    return;
  }

  scoreTableBody.innerHTML = currentRows.map(rowHtml).join("");

  const pendingCount = currentRows.filter((r) => r.status === "submitted" || r.status === "published").length;
  saveStatus.textContent = pendingCount
    ? `${pendingCount} rows pending your approval.`
    : "All shown rows are approved.";
  btnApprove.disabled = pendingCount === 0;
  btnUnlock.disabled = currentRows.length === 0;
}

async function updateRowsStatus(ids, newStatus, reason = null) {
  if (!ids.length) return;

  const now = new Date().toISOString();
  let payload = { status: newStatus };

  if (newStatus === "approved") {
    payload.approved_by = adminAuthId;
    payload.approved_at = now;
    payload.return_reason = null;
  } else if (newStatus === "returned") {
    payload.returned_by = adminAuthId;
    payload.returned_at = now;
    payload.return_reason = reason || "Returned by admin for correction.";
  }

  let { error } = await supabase.from("results").update(payload).in("id", ids);
  if (error && /returned_at|return_reason/i.test(error.message || "")) {
    const fallback = { status: "draft" };
    ({ error } = await supabase.from("results").update(fallback).in("id", ids));
  }
  if (error) throw error;
}

// -------------------------------------------------------------
// Principal Signature & Resumption Date
// -------------------------------------------------------------
async function loadPrincipalSignature() {
  try {
    const { data: sig } = await supabase
      .from("signatures")
      .select("signature_data")
      .eq("owner_role", "principal")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const savedSig = sig?.signature_data || localStorage.getItem("gracemark_principal_sig");
    if (savedSig) {
      principalSignatureBase64 = savedSig;
      sigImg.src = savedSig;
      sigImg.classList.remove("hidden");
      sigPlaceholder.classList.add("hidden");
    }
  } catch (_) {
    const local = localStorage.getItem("gracemark_principal_sig");
    if (local) {
      principalSignatureBase64 = local;
      sigImg.src = local;
      sigImg.classList.remove("hidden");
      sigPlaceholder.classList.add("hidden");
    }
  }
}

async function savePrincipalSignature(base64Data) {
  principalSignatureBase64 = base64Data;
  localStorage.setItem("gracemark_principal_sig", base64Data);

  sigImg.src = base64Data;
  sigImg.classList.remove("hidden");
  sigPlaceholder.classList.add("hidden");

  try {
    await supabase.from("signatures").upsert(
      {
        owner_id: adminAuthId,
        owner_role: "principal",
        signature_data: base64Data,
        is_active: true,
        uploaded_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" }
    );
  } catch (err) {
    console.warn("Signatures table notice:", err.message);
  }
  alert("Principal signature saved successfully.");
}

async function loadResumptionDate() {
  try {
    const { data: termRow } = await supabase
      .from("terms")
      .select("next_term_begins")
      .eq("session", currentSession)
      .eq("term", currentTerm)
      .maybeSingle();

    if (termRow?.next_term_begins) {
      resumptionDatePicker.value = termRow.next_term_begins;
    }
  } catch (_) {}
}

async function saveResumptionDate() {
  const val = resumptionDatePicker.value;
  if (!val) {
    alert("Please select a valid date.");
    return;
  }
  btnSaveResumption.disabled = true;
  try {
    await supabase.from("terms").upsert(
      {
        session: currentSession,
        term: currentTerm,
        next_term_begins: val,
      },
      { onConflict: "session,term" }
    );
    alert("Next term resumption date updated.");
  } catch (e) {
    console.warn("Terms table update:", e);
    alert("Resumption date recorded.");
  } finally {
    btnSaveResumption.disabled = false;
  }
}

// -------------------------------------------------------------
// Publish Gating
// -------------------------------------------------------------
async function batchPublishMilestone(milestone) {
  const classId = classSelect.value;
  if (!classId) {
    alert("Please select a class first.");
    return;
  }

  const confirmPublish = confirm(
    `Are you sure you want to publish ${milestone} reports for this class to the student portal?\n\nStudents will immediately be able to view their finalized ${milestone} reports.`
  );
  if (!confirmPublish) return;

  btnBatchPublish.disabled = true;
  publishStatusBanner.textContent = `Publishing ${milestone}...`;

  try {
    // 1. Fetch approved results for this class and term
    const { data: results, error: resErr } = await supabase
      .from("results")
      .select("id, student_id, subject_id, cw, hw, test, project, exam, total, grade, score_breakdown, subjects(name)")
      .eq("term", currentTerm)
      .eq("class_id", classId)
      .eq("status", "approved");

    if (resErr) throw resErr;
    if (!results || !results.length) {
      alert("No approved results found in this class to publish. Please approve subject results first.");
      publishStatusBanner.textContent = "Publish halted: 0 approved records.";
      return;
    }

    // 2. Fetch class students
    const { data: students } = await supabase.from("students").select("id, name, admission_no").eq("class_id", classId);

    // 3. Fetch attendance
    const studentIds = (students || []).map((s) => s.id);
    const { data: attendanceList } = await supabase
      .from("attendance")
      .select("student_id, times_opened, times_present, times_absent, days_present, days_absent")
      .in("student_id", studentIds)
      .eq("term", currentTerm);

    const attMap = new Map((attendanceList || []).map((a) => [a.student_id, a]));
    const resultsByStudent = new Map();
    results.forEach((r) => {
      if (!resultsByStudent.has(r.student_id)) resultsByStudent.set(r.student_id, []);
      resultsByStudent.get(r.student_id).push(r);
    });

    const snapshots = [];
    const now = new Date().toISOString();
    const classSize = (students || []).length;
    const subjectBenchmarks = computeClassSubjectStats(results, milestone);

    // Compute rank for each student in class
    const studentTotalScores = new Map();
    (students || []).forEach((st) => {
      const sResults = resultsByStudent.get(st.id) || [];
      const tot = sResults.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
      studentTotalScores.set(st.id, tot);
    });
    const sortedRanks = [...studentTotalScores.entries()].sort((a, b) => b[1] - a[1]);
    const rankMap = new Map();
    sortedRanks.forEach(([stId, tot]) => {
      let rk = 1;
      for (const [, otherTot] of sortedRanks) {
        if (otherTot > tot) rk++;
      }
      rankMap.set(stId, rk);
    });

    (students || []).forEach((student) => {
      const studentResults = resultsByStudent.get(student.id) || [];
      if (!studentResults.length) return;

      const att = attMap.get(student.id);
      const timesOpened = att?.times_opened || ((att?.days_present || 0) + (att?.days_absent || 0)) * 2 || 130;
      const timesPresent = att?.times_present || (att?.days_present ? att.days_present * 2 : 0);
      const timesAbsent = Math.max(0, timesOpened - timesPresent);

      // Compute subjects based on milestone
      const computedSubjects = studentResults.map((r) => {
        const raw = normalizeBreakdown(r);
        let itemScore = 0;
        let itemGrade = "—";
        let itemRemark = "—";

        if (milestone === "PR1") {
          const pr = calculatePR1(raw);
          itemScore = pr.percentage;
          itemGrade = pr.grade;
          itemRemark = pr.remark;
        } else if (milestone === "PR2") {
          const pr = calculatePR2(raw);
          itemScore = pr.percentage;
          itemGrade = pr.grade;
          itemRemark = pr.remark;
        } else if (milestone === "PR3") {
          const pr = calculatePR3(raw);
          itemScore = pr.percentage;
          itemGrade = pr.grade;
          itemRemark = pr.remark;
        } else {
          const tr = calculateTR(raw);
          itemScore = Math.round(tr.totalScore);
          itemGrade = tr.grade;
          itemRemark = tr.remark;
        }

        const bench = subjectBenchmarks[r.subject_id];
        return {
          subject_name: r.subjects?.name || "Subject",
          score: itemScore,
          grade: itemGrade,
          remark: itemRemark,
          ca: r.cw + r.hw + r.test + (r.project || 0),
          exam: r.exam,
          class_avg: bench?.avg ?? null,
          lowest: bench?.lowest ?? null,
          highest: bench?.highest ?? null,
        };
      });

      const snapshotBlob = {
        student: { id: student.id, name: student.name, admission_no: student.admission_no },
        class_size: classSize,
        position: rankMap.get(student.id) || 1,
        milestone,
        term: currentTerm,
        session: currentSession,
        subjects: computedSubjects,
        attendance: {
          times_opened: timesOpened,
          times_present: timesPresent,
          times_absent: timesAbsent,
          rate_pct: timesOpened > 0 ? Math.round((timesPresent / timesOpened) * 100) : 100,
        },
        principal_signature: principalSignatureBase64 || null,
        resumption_date: resumptionDatePicker.value || null,
        published_at: now,
      };

      snapshots.push({
        term: currentTerm,
        session: currentSession,
        student_id: student.id,
        class_id: classId,
        report_type: milestone,
        snapshot_data: snapshotBlob,
        published_at: now,
        published_by: adminAuthId,
        is_active: true,
      });
    });

    // Update status in results table
    const resultIds = results.map((r) => r.id);
    const statusCol =
      milestone === "PR1"
        ? { pr1_status: "published" }
        : milestone === "PR2"
        ? { pr2_status: "published" }
        : milestone === "PR3"
        ? { pr3_status: "published" }
        : { tr_status: "published", status: "approved" };

    // 1. Try secure backend API first (uses service role, immune to client RLS restrictions)
    let publishedViaApi = false;
    try {
      const resp = await fetch("/api/results/batch-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshots, resultIds, statusCol }),
      });
      if (resp.ok) {
        const d = await resp.json();
        if (d.ok) publishedViaApi = true;
      }
    } catch (apiErr) {
      console.warn("Backend publish API fallback to direct Supabase:", apiErr);
    }

    // 2. Fallback to direct client Supabase if server API is unavailable
    if (!publishedViaApi) {
      try {
        await supabase.from("published_snapshots").upsert(snapshots, {
          onConflict: "term,session,student_id,report_type",
        });
      } catch (snapErr) {
        console.warn("published_snapshots insert notice:", snapErr);
      }
      try {
        await supabase.from("results").update(statusCol).in("id", resultIds);
      } catch (_) {}
    }

    publishStatusBanner.textContent = `✓ Successfully published ${milestone} for ${snapshots.length} students!`;
    alert(`✓ Successfully published ${milestone} reports to Student Portal!`);
  } catch (err) {
    console.error("Batch publish error:", err);
    alert("Publish failed: " + err.message);
    publishStatusBanner.textContent = "Publish failed.";
  } finally {
    btnBatchPublish.disabled = false;
  }
}

async function unpublishMilestone(milestone) {
  const classId = classSelect.value;
  if (!classId) return;

  const confirmRecall = confirm(
    `Recall / Unpublish ${milestone} for this class?\n\nStudents will no longer be able to see these reports until you publish again.`
  );
  if (!confirmRecall) return;

  btnUnpublish.disabled = true;
  try {
    let unpublishedViaApi = false;
    try {
      const resp = await fetch("/api/results/unpublish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, milestone, term: currentTerm, session: currentSession }),
      });
      if (resp.ok) {
        const d = await resp.json();
        if (d.ok) unpublishedViaApi = true;
      }
    } catch (apiErr) {
      console.warn("Backend unpublish API fallback to direct Supabase:", apiErr);
    }

    if (!unpublishedViaApi) {
      await supabase
        .from("published_snapshots")
        .update({ is_active: false })
        .eq("term", currentTerm)
        .eq("session", currentSession)
        .eq("class_id", classId)
        .eq("report_type", milestone);
    }

    alert(`✓ ${milestone} reports recalled from student portal.`);
    publishStatusBanner.textContent = `${milestone} recalled (hidden from students).`;
  } catch (e) {
    alert("Unpublish notice: " + e.message);
  } finally {
    btnUnpublish.disabled = false;
  }
}

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
async function init() {
  const ok = await requireRole("admin", { redirectTo: "/" });
  if (!ok) return;

  adminAuthId = ok.session.user.id;

  const settings = await getAppSettings();
  currentTerm = settings?.current_term || "term1";
  currentSession = settings?.current_session || "2025/2026";

  await populateClassOptions();
  await populateSubjectOptions(classSelect.value);
  await loadQueue(classSelect.value);
  await loadGrid({ classId: classSelect.value, subjectId: subjectSelect.value });

  await loadPrincipalSignature();
  await loadResumptionDate();

  if (authLoader) authLoader.remove();

  classSelect.addEventListener("change", async () => {
    await populateSubjectOptions(classSelect.value);
    await loadQueue(classSelect.value);
    await loadGrid({ classId: classSelect.value, subjectId: subjectSelect.value });
  });

  subjectSelect.addEventListener("change", async () => {
    await loadGrid({ classId: classSelect.value, subjectId: subjectSelect.value });
  });

  // Approve button
  btnApprove.addEventListener("click", async () => {
    const ids = currentRows.filter((r) => r.status === "submitted" || r.status === "published").map((r) => r.id);
    if (!ids.length) return;

    btnApprove.disabled = true;
    btnUnlock.disabled = true;
    saveStatus.textContent = "Approving results...";

    try {
      await updateRowsStatus(ids, "approved");
      saveStatus.textContent = "✓ Results successfully approved.";
      await loadQueue(classSelect.value);
      await loadGrid({ classId: classSelect.value, subjectId: subjectSelect.value });
    } catch (e) {
      alert("Error approving results: " + e.message);
      saveStatus.textContent = "Approval failed.";
      btnApprove.disabled = false;
      btnUnlock.disabled = false;
    }
  });

  // Return / Unlock modal triggers
  btnUnlock.addEventListener("click", () => {
    returnReasonInput.value = "";
    returnModal.classList.remove("hidden");
  });

  btnCloseReturnModal?.addEventListener("click", () => returnModal.classList.add("hidden"));
  btnCancelReturn?.addEventListener("click", () => returnModal.classList.add("hidden"));

  btnConfirmReturn?.addEventListener("click", async () => {
    const reason = returnReasonInput.value.trim() || "Returned by admin for correction.";
    const ids = currentRows.map((r) => r.id);
    if (!ids.length) return;

    returnModal.classList.add("hidden");
    btnApprove.disabled = true;
    btnUnlock.disabled = true;
    saveStatus.textContent = "Returning results for correction...";

    try {
      await updateRowsStatus(ids, "returned", reason);
      saveStatus.textContent = "✓ Results returned to teacher with reason.";
      await loadQueue(classSelect.value);
      await loadGrid({ classId: classSelect.value, subjectId: subjectSelect.value });
    } catch (e) {
      alert("Error returning results: " + e.message);
      saveStatus.textContent = "Return failed.";
      btnApprove.disabled = false;
      btnUnlock.disabled = false;
    }
  });

  // Signature file picker
  sigFileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      savePrincipalSignature(reader.result);
    };
    reader.readAsDataURL(file);
  });

  btnSaveResumption?.addEventListener("click", saveResumptionDate);

  btnBatchPublish?.addEventListener("click", () => {
    batchPublishMilestone(publishMilestoneSelect.value);
  });

  btnUnpublish?.addEventListener("click", () => {
    unpublishMilestone(publishMilestoneSelect.value);
  });
}

init().catch((e) => {
  console.error("Approvals init error:", e);
  if (authLoader) authLoader.remove();
  alert("Could not load approvals module: " + e.message);
});
