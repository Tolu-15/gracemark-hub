import { supabase } from "/js/shared/supabaseClient.js";
import { getLatestAppSettings } from "/js/shared/appSettings.js";
import {
  normalizeBreakdown,
  calculateStudentResult,
  isSeniorClass,
  getGradeAndRemark,
  calculatePR1,
  calculatePR2,
  calculatePR3,
  calculateTR,
} from "/shared/gradingEngine.js";
import {
  gradeToRemark,
  buildPrincipalRemark,
  getPromotionStatus,
  buildTraits,
  generateAiInsight,
  EXCEL_PERSONAL_SKILLS,
} from "./insight.js";

const TERM_OPTIONS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

export const PR_INTERVALS = [
  { value: "pr1", label: "PR 1 (Weeks 1 – 4)", shortLabel: "PR 1", weeks: "Weeks 1 – 4", checkpoint: "Week 4", testIndex: 0 },
  { value: "pr2", label: "PR 2 (Weeks 1 – 7)", shortLabel: "PR 2", weeks: "Weeks 1 – 7", checkpoint: "Week 7", testIndex: 1 },
  { value: "pr3", label: "PR 3 (Weeks 1 – 10)", shortLabel: "PR 3", weeks: "Weeks 1 – 10", checkpoint: "Week 10", testIndex: 2 },
];

export function termLabel(term) {
  return TERM_OPTIONS.find((t) => t.value === term)?.label ?? term;
}

function computePrForInterval(raw, fallbackScores, testIndex, isSenior) {
  if (raw && (raw.cw?.length || raw.tests?.length)) {
    if (testIndex === 0) {
      const pr = calculatePR1(raw, isSenior);
      return {
        cw: pr.hasData ? pr.cw : "—",
        hw: pr.hasData ? pr.hw : "—",
        test: pr.hasData ? pr.test : "—",
        cwNum: pr.cw,
        hwNum: pr.hw,
        testNum: pr.test,
        totalCa: pr.totalCA,
        percentage: pr.percentage,
        grade: pr.grade,
        status: pr.remark,
        hasData: pr.hasData,
      };
    } else if (testIndex === 1) {
      const pr = calculatePR2(raw, isSenior);
      return {
        cw: pr.hasData ? pr.cw : "—",
        hw: pr.hasData ? pr.hw : "—",
        test: pr.hasData ? pr.test : "—",
        cwNum: pr.cw,
        hwNum: pr.hw,
        testNum: pr.test,
        totalCa: pr.totalCA,
        percentage: pr.percentage,
        grade: pr.grade,
        status: pr.remark,
        hasData: pr.hasData,
      };
    } else {
      const pr = calculatePR3(raw, isSenior);
      return {
        cw: pr.hasData ? pr.cw : "—",
        hw: pr.hasData ? pr.hw : "—",
        test: pr.hasData ? pr.test : "—",
        cwNum: pr.cw,
        hwNum: pr.hw,
        testNum: pr.test,
        totalCa: pr.totalCA,
        percentage: pr.percentage,
        grade: pr.grade,
        status: pr.remark,
        hasData: pr.hasData,
      };
    }
  }

  // Fallback for legacy single CA scores (CW /10, HW /5, Test /10)
  const cwItem = fallbackScores.cw ?? 0;
  const hwItem = fallbackScores.hw ?? 0;
  const testItem = +((fallbackScores.test ?? 0) * 1.5).toFixed(1);
  const hasData = cwItem > 0 || hwItem > 0 || testItem > 0;

  const prCw = Math.min(10, Math.max(0, cwItem));
  const prHw = Math.min(5, Math.max(0, hwItem));
  const prTest = Math.min(15, Math.max(0, testItem));

  const totalCa = +(prCw + prHw + prTest).toFixed(1);
  const percentage = Math.min(100, +((totalCa / 30) * 100).toFixed(1));
  const { grade, remark: status } = getGradeAndRemark(percentage, isSenior);

  return {
    cw: hasData ? prCw : "—",
    hw: hasData ? prHw : "—",
    test: hasData ? prTest : "—",
    cwNum: prCw,
    hwNum: prHw,
    testNum: prTest,
    totalCa: hasData ? totalCa : 0,
    percentage: hasData ? percentage : 0,
    grade: hasData ? grade : "—",
    status: hasData ? status : "NOT ENTERED",
    hasData,
  };
}

function buildPrIntervalMetrics(intervalKey, intervalMeta, rows, isSenior) {
  const hasAnyData = rows.some((r) => r.prs?.[intervalKey]?.hasData);
  const targetRows = hasAnyData ? rows.filter((r) => r.prs?.[intervalKey]?.hasData) : rows;
  const totalCa = +(targetRows.reduce((s, r) => s + (r.prs?.[intervalKey]?.totalCa || 0), 0)).toFixed(1);
  const overallPercentage = targetRows.length
    ? +(targetRows.reduce((s, r) => s + (r.prs?.[intervalKey]?.percentage || 0), 0) / targetRows.length).toFixed(1)
    : 0;
  const maxCa = targetRows.length * 30;
  const summary = targetRows.length
    ? getGradeAndRemark(overallPercentage, isSenior).remark
    : "—";

  return {
    interval: intervalMeta,
    overallPercentage,
    totalCa,
    maxCa,
    summary,
    hasData: hasAnyData,
    assessedCount: targetRows.length,
  };
}

export async function fetchStudentReport({ student, term, session }) {
  if (!student?.id) throw new Error("Student profile not loaded.");

  const classId = student.class_id;
  const className = student.classes?.name ?? "—";
  const isSenior = isSeniorClass(className);

  let resultsQuery = supabase
    .from("results")
    .select(
      "id, subject_id, cw, hw, test, project, exam, total, grade, score_breakdown, subjects(name)"
    )
    .eq("student_id", student.id)
    .eq("term", term)
    .eq("status", "approved");

  if (session) {
    resultsQuery = resultsQuery.eq("session", session);
  }

  let { data: results, error } = await resultsQuery;
  if (error && /score_breakdown|session/i.test(error.message || "")) {
    let fallbackQuery = supabase
      .from("results")
      .select("id, subject_id, cw, hw, test, project, exam, total, grade, subjects(name)")
      .eq("student_id", student.id)
      .eq("term", term)
      .eq("status", "approved");
    if (session) fallbackQuery = fallbackQuery.eq("session", session);
    ({ data: results, error } = await fallbackQuery);
  }
  if (error) throw error;

  // Fetch all approved results for the session to compute cumulative averages (specifically for Term 3)
  let allSessionQuery = supabase
    .from("results")
    .select("subject_id, term, total")
    .eq("student_id", student.id)
    .eq("status", "approved");
  if (session) allSessionQuery = allSessionQuery.eq("session", session);

  const { data: allSessionResults } = await allSessionQuery;

  const sessionResultsMap = new Map(); // subject_id -> { term1, term2, term3 }
  (allSessionResults || []).forEach((r) => {
    if (!sessionResultsMap.has(r.subject_id)) {
      sessionResultsMap.set(r.subject_id, {});
    }
    sessionResultsMap.get(r.subject_id)[r.term] = Number(r.total) || 0;
  });

  const rows = (results ?? []).map((row) => {
    const raw = normalizeBreakdown(row);
    const computed = calculateStudentResult(raw, undefined, { isSenior, className });
    const subjectName = row.subjects?.name ?? "Subject";

    const cw = row.cw !== undefined && row.cw !== null ? Number(row.cw) : Math.round(computed.scaled.cw);
    const hw = row.hw !== undefined && row.hw !== null ? Number(row.hw) : Math.round(computed.scaled.hw);
    const test = row.test !== undefined && row.test !== null ? Number(row.test) : Math.round(computed.scaled.tests);
    const project = row.project !== undefined && row.project !== null ? Number(row.project) : Math.round(computed.scaled.project);
    const exam = row.exam !== undefined && row.exam !== null ? Number(row.exam) : Math.round(computed.scaled.exam);
    const currentTermTotal = row.total !== undefined && row.total !== null ? Number(row.total) : Math.round(computed.totalScore);

    const term1_total = sessionResultsMap.get(row.subject_id)?.term1 ?? (term === "term1" ? currentTermTotal : null);
    const term2_total = sessionResultsMap.get(row.subject_id)?.term2 ?? (term === "term2" ? currentTermTotal : null);
    const term3_total = term === "term3" ? currentTermTotal : (sessionResultsMap.get(row.subject_id)?.term3 ?? null);

    let annualAverage = null;
    if (term === "term3") {
      let sum = 0;
      let count = 0;
      if (term1_total !== null && term1_total !== undefined) { sum += term1_total; count++; }
      if (term2_total !== null && term2_total !== undefined) { sum += term2_total; count++; }
      if (term3_total !== null && term3_total !== undefined) { sum += term3_total; count++; }
      annualAverage = count > 0 ? +(sum / count).toFixed(1) : currentTermTotal;
    }

    // Progress Report (PR / Continuous Assessment) intervals:
    // PR 1: Weeks 1 – 3 (Test 1 at Week 3)
    // PR 2: Weeks 4 – 6 (Test 2 at Week 6)
    // PR 3: Weeks 7 – 9 (Test 3 at Week 9)
    const pr1 = computePrForInterval(raw, { cw, hw, test }, 0, isSenior);
    const pr2 = computePrForInterval(raw, { cw, hw, test }, 1, isSenior);
    const pr3 = computePrForInterval(raw, { cw, hw, test }, 2, isSenior);

    return {
      subject: subjectName,
      subjectId: row.subject_id,
      cw,
      hw,
      test,
      project,
      exam,
      total: currentTermTotal,
      term1_total,
      term2_total,
      term3_total,
      annualAverage,
      grade: row.grade && term !== "term3" ? row.grade : grade,
      remark: row.grade && term !== "term3" ? gradeToRemark(row.grade) : remark,
      pr: pr1,
      prs: {
        pr1,
        pr2,
        pr3,
      },
      classAverage: null,
      high: null,
      low: null,
    };
  });

  rows.sort((a, b) => a.subject.localeCompare(b.subject));

  let classSize = 0;
  let position = null;
  let averagesMap = new Map();

  if (classId) {
    try {
      const qUrl = `/api/student/class-benchmarks?class_id=${encodeURIComponent(classId)}&term=${encodeURIComponent(term)}&session=${encodeURIComponent(session || "")}&student_id=${encodeURIComponent(student.id)}`;
      const resp = await fetch(qUrl);
      if (resp.ok) {
        const json = await resp.json();
        if (json.ok) {
          classSize = json.classSize || 0;
          position = json.position || null;
          averagesMap = new Map(Object.entries(json.subjectBenchmarks || {}));
        }
      }
    } catch (benchErr) {
      console.warn("Could not fetch class benchmarks from API:", benchErr);
    }
  }

  rows.forEach((r) => {
    const avg = averagesMap.get(r.subjectId);
    if (avg) {
      r.classAverage = typeof avg.avg === "number" ? +avg.avg.toFixed(1) : Math.round(avg.avg ?? 0);
      r.high = typeof avg.highest === "number" ? +avg.highest.toFixed(1) : Math.round(avg.highest ?? 0);
      r.low = typeof avg.lowest === "number" ? +avg.lowest.toFixed(1) : Math.round(avg.lowest ?? 0);
    } else {
      r.classAverage = "—";
      r.high = "—";
      r.low = "—";
    }
  });

  const { data: attendance } = await supabase
    .from("attendance")
    .select("times_opened, times_present, times_absent, days_present, days_absent")
    .eq("student_id", student.id)
    .eq("term", term)
    .maybeSingle();

  const timesOpened = attendance?.times_opened || ((attendance?.days_present || 0) + (attendance?.days_absent || 0)) * 2 || 130;
  const timesPresent = attendance?.times_present ?? (attendance?.days_present ? attendance.days_present * 2 : 0);
  const timesAbsent = attendance?.times_absent ?? Math.max(0, timesOpened - timesPresent);
  const daysOpened = Math.round(timesOpened / 2);
  const daysPresent = Math.round(timesPresent / 2);
  const attendancePct = timesOpened > 0 ? Math.round((timesPresent / timesOpened) * 100) : 95;

  // Calculate overall marks (GPA intentionally omitted per requirements)
  const sumOfScores = rows.reduce((s, r) => {
    const val = term === "term3" && r.annualAverage !== null ? r.annualAverage : r.total;
    return s + val;
  }, 0);

  const overallTotal = rows.length ? +sumOfScores.toFixed(1) : 0;
  const percentage = rows.length ? +(sumOfScores / rows.length).toFixed(1) : 0;

  const strengths = rows.filter((r) => {
    const g = String(r.grade || "").toUpperCase();
    return g === "A" || g === "B" || g === "A1" || g === "B2" || g === "B3";
  }).map((r) => r.subject);

  const weaknesses = rows.filter((r) => {
    const g = String(r.grade || "").toUpperCase();
    return g === "D" || g === "F" || g === "D7" || g === "E8" || g === "F9";
  }).map((r) => r.subject);

  // Fetch real affective & psychomotor traits and remarks from public.student_evaluations
  const { data: evaluations } = await supabase
    .from("student_evaluations")
    .select("*")
    .eq("student_id", student.id)
    .eq("term", term)
    .eq("session", session || "—")
    .maybeSingle();

  // Map the 12 Personal Skills from the official Excel templates
  const traitsFallback = buildTraits({ percentage, attendancePct });
  const traitsList = EXCEL_PERSONAL_SKILLS.map((skillName) => {
    const key = skillName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const foundVal = evaluations?.[key] ?? evaluations?.[skillName.toLowerCase()];
    const fallbackScore = traitsFallback.find((t) => t.name === skillName)?.score ?? 4;
    return {
      name: skillName,
      score: foundVal !== null && foundVal !== undefined ? foundVal : fallbackScore,
      max: 5,
    };
  });

  const traitsTotal = traitsList.reduce((s, t) => s + (Number(t.score) || 0), 0);

  const teacherRemark = evaluations?.teacher_remark || "A commendable performance. Keep up the good work.";
  const principalRemark = evaluations?.principal_remark || buildPrincipalRemark({ percentage });

  // Stamped Signature & Resumption Date
  let principalSignature = null;
  let nextTermBegins = "Monday 5th January, 2026";
  let publishedDate = null;
  let isPublished = false;

  try {
    const { data: snapshot } = await supabase
      .from("published_snapshots")
      .select("snapshot_data, published_at, is_active")
      .eq("student_id", student.id)
      .eq("term", term)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (snapshot?.snapshot_data) {
      isPublished = true;
      publishedDate = snapshot.published_at
        ? new Date(snapshot.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
        : null;
      if (snapshot.snapshot_data.principal_signature) {
        principalSignature = snapshot.snapshot_data.principal_signature;
      }
      if (snapshot.snapshot_data.resumption_date) {
        nextTermBegins = snapshot.snapshot_data.resumption_date;
      }
      if (snapshot.snapshot_data.class_size) {
        classSize = snapshot.snapshot_data.class_size;
      }
      if (snapshot.snapshot_data.position) {
        position = snapshot.snapshot_data.position;
      }
      if (Array.isArray(snapshot.snapshot_data.subjects)) {
        const snapSubjs = new Map(snapshot.snapshot_data.subjects.map((s) => [s.subject_name, s]));
        rows.forEach((r) => {
          const s = snapSubjs.get(r.subject);
          if (s) {
            if (s.class_avg !== undefined && s.class_avg !== null) r.classAverage = s.class_avg;
            if (s.lowest !== undefined && s.lowest !== null) r.low = s.lowest;
            if (s.highest !== undefined && s.highest !== null) r.high = s.highest;
          }
        });
      }
    }
  } catch (_) {}

  if (!principalSignature) {
    try {
      const { data: sig } = await supabase
        .from("signatures")
        .select("signature_data")
        .eq("owner_role", "principal")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      principalSignature = sig?.signature_data || localStorage.getItem("gracemark_principal_sig");
    } catch (_) {
      principalSignature = localStorage.getItem("gracemark_principal_sig");
    }
  }

  try {
    const { data: termRow } = await supabase
      .from("terms")
      .select("next_term_begins")
      .eq("term", term)
      .limit(1)
      .maybeSingle();
    if (termRow?.next_term_begins) {
      nextTermBegins = termRow.next_term_begins;
    }
  } catch (_) {}

  const report = {
    studentName: student.name,
    admissionNo: student.admission_no,
    className,
    isSenior,
    session: session || "—",
    term,
    termLabel: termLabel(term),
    totalResults: rows.length,
    position: position ? `${ordinal(position)}` : "—",
    positionNum: position,
    overallTotal,
    totalScore: overallTotal,
    percentage,
    attendancePct,
    classSize: classSize || "—",
    timesOpened,
    timesPresent,
    timesAbsent,
    daysOpened,
    daysPresent,
    principalSignature,
    publishedDate,
    isPublished,
    subjects: rows,
    strengths,
    weaknesses,
    nextTermBegins,
    traits: traitsList,
    traitsTotal,
    teacherRemark,
    principalRemark,
    // Progress Report (PR / Continuous Assessment) metrics across 3 intervals
    prIntervals: {
      pr1: buildPrIntervalMetrics("pr1", PR_INTERVALS[0], rows, isSenior),
      pr2: buildPrIntervalMetrics("pr2", PR_INTERVALS[1], rows, isSenior),
      pr3: buildPrIntervalMetrics("pr3", PR_INTERVALS[2], rows, isSenior),
    },
    prOverallPercentage: buildPrIntervalMetrics("pr1", PR_INTERVALS[0], rows, isSenior).overallPercentage,
    prTotalCa: buildPrIntervalMetrics("pr1", PR_INTERVALS[0], rows, isSenior).totalCa,
    prMaxCa: buildPrIntervalMetrics("pr1", PR_INTERVALS[0], rows, isSenior).maxCa,
    prSummary: buildPrIntervalMetrics("pr1", PR_INTERVALS[0], rows, isSenior).summary,
  };

  report.promotionStatus = getPromotionStatus(report);
  report.aiInsight = generateAiInsight(report);

  return report;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export async function loadSessions() {
  try {
    const settings = await getLatestAppSettings();
    const currSession = settings?.current_session?.trim();

    const { data: dbSessions } = await supabase
      .from("classes")
      .select("session")
      .not("session", "is", null);

    const set = new Set(["2024/2025", "2025/2026", "2026/2027", "2027/2028"]);
    if (currSession) set.add(currSession);
    (dbSessions || []).forEach((r) => {
      if (r.session && r.session.trim()) set.add(r.session.trim());
    });

    return Array.from(set).sort((a, b) => b.localeCompare(a));
  } catch {
    return ["2027/2028", "2026/2027", "2025/2026", "2024/2025"];
  }
}

export { TERM_OPTIONS };
