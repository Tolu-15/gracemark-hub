import { supabase } from "/js/shared/supabaseClient.js";
import { getLatestAppSettings } from "/js/shared/appSettings.js";
import { normalizeBreakdown, calculateStudentResult } from "/shared/gradingEngine.js";
import { gradeToGpaPoint, gradeToRemark, buildPrincipalRemark, getPromotionStatus, buildTraits, generateAiInsight } from "./insight.js";

const TERM_OPTIONS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

export function termLabel(term) {
  return TERM_OPTIONS.find((t) => t.value === term)?.label ?? term;
}

export async function fetchStudentReport({ student, term, session }) {
  if (!student?.id) throw new Error("Student profile not loaded.");

  const classId = student.class_id;
  const className = student.classes?.name ?? "—";

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
    const computed = calculateStudentResult(raw);
    const subjectName = row.subjects?.name ?? "Subject";
    
    const term1_total = sessionResultsMap.get(row.subject_id)?.term1 ?? null;
    const term2_total = sessionResultsMap.get(row.subject_id)?.term2 ?? null;
    const term3_total = row.total ?? computed.totalScore;
    
    let annualTotal = null;
    if (term === "term3") {
      let sum = term3_total;
      let count = 1;
      if (term1_total !== null) { sum += term1_total; count++; }
      if (term2_total !== null) { sum += term2_total; count++; }
      annualTotal = Math.round(sum / count);
    }

    return {
      subject: subjectName,
      subjectId: row.subject_id,
      hw: Math.round(row.hw ?? computed.scaled.hw),
      test: Math.round(row.test ?? computed.scaled.tests),
      project: Math.round(row.project ?? computed.scaled.project),
      exam: Math.round(row.exam ?? computed.scaled.exam),
      total: Math.round(term3_total),
      term1_total,
      term2_total,
      term3_total,
      annualTotal,
      grade: row.grade ?? computed.grade,
      remark: gradeToRemark(row.grade ?? computed.grade),
      classAverage: null,
      high: null,
      low: null,
    };
  });

  rows.sort((a, b) => a.subject.localeCompare(b.subject));

  let averagesMap = new Map();
  if (classId && rows.length) {
    const { data: avgs } = await supabase
      .from("class_averages")
      .select("subject_id, avg, lowest, highest")
      .eq("class_id", classId)
      .eq("term", term);
    averagesMap = new Map((avgs ?? []).map((a) => [a.subject_id, a]));
  }

  rows.forEach((r) => {
    const avg = averagesMap.get(r.subjectId);
    if (avg) {
      r.classAverage = Math.round(avg.avg ?? 0);
      r.high = Math.round(avg.highest ?? 0);
      r.low = Math.round(avg.lowest ?? 0);
    } else {
      r.classAverage = "—";
      r.high = "—";
      r.low = "—";
    }
  });

  const { data: attendance } = await supabase
    .from("attendance")
    .select("days_present, days_absent")
    .eq("student_id", student.id)
    .eq("term", term)
    .maybeSingle();

  const daysPresent = attendance?.days_present ?? 0;
  const daysAbsent = attendance?.days_absent ?? 0;
  const daysOpened = Math.max(daysPresent + daysAbsent, 120);
  const attendancePct =
    daysPresent + daysAbsent > 0 ? Math.round((daysPresent / (daysPresent + daysAbsent)) * 100) : 92;

  let classSize = 0;
  let position = null;
  if (classId) {
    const { count } = await supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("class_id", classId);
    classSize = count ?? 0;

    const { data: classStudents } = await supabase.from("students").select("id").eq("class_id", classId);
    const ids = (classStudents ?? []).map((s) => s.id);
    if (ids.length) {
      const { data: classResults } = await supabase
        .from("results")
        .select("student_id, total")
        .in("student_id", ids)
        .eq("term", term)
        .eq("status", "approved");

      const totalsByStudent = new Map();
      (classResults ?? []).forEach((r) => {
        const t = Number(r.total) || 0;
        totalsByStudent.set(r.student_id, (totalsByStudent.get(r.student_id) ?? 0) + t);
      });

      const sorted = [...totalsByStudent.entries()].sort((a, b) => b[1] - a[1]);
      const myTotal = totalsByStudent.get(student.id) ?? 0;
      let rank = 1;
      for (const [, total] of sorted) {
        if (total > myTotal) rank += 1;
      }
      if (sorted.some(([id]) => id === student.id)) position = rank;
    }
  }

  const totalScore = rows.length ? Math.round(rows.reduce((s, r) => s + r.total, 0) / rows.length) : 0;
  const percentage = totalScore;
  const totalGpaPoints = rows.reduce((s, r) => s + gradeToGpaPoint(r.grade), 0);
  const gpa = rows.length ? +(totalGpaPoints / rows.length).toFixed(2) : 0;

  const strengths = rows.filter((r) => r.grade === "A" || r.grade === "B").map((r) => r.subject);
  const weaknesses = rows.filter((r) => r.grade === "D" || r.grade === "F").map((r) => r.subject);

  // Fetch real affective & psychomotor traits and remarks from public.student_evaluations
  const { data: evaluations } = await supabase
    .from("student_evaluations")
    .select("*")
    .eq("student_id", student.id)
    .eq("term", term)
    .eq("session", session || "—")
    .maybeSingle();

  const TRAIT_NAMES = [
    { key: "punctuality", label: "Punctuality" },
    { key: "neatness", label: "Neatness" },
    { key: "honesty", label: "Honesty" },
    { key: "politeness", label: "Politeness" },
    { key: "cooperation", label: "Cooperation" },
    { key: "leadership", label: "Leadership" },
    { key: "handwriting", label: "Handwriting" },
    { key: "sports", label: "Sports" },
    { key: "crafts", label: "Crafts" },
    { key: "music", label: "Music" },
  ];

  const traitsList = TRAIT_NAMES.map(({ key, label }) => ({
    name: label,
    score: evaluations?.[key] !== null && evaluations?.[key] !== undefined ? evaluations[key] : "—",
    max: 5,
  }));

  const teacherRemark = evaluations?.teacher_remark || "No comment entered yet.";
  const principalRemark = evaluations?.principal_remark || buildPrincipalRemark({ percentage, gpa });

  const report = {
    studentName: student.name,
    admissionNo: student.admission_no,
    className,
    session: session || "—",
    term,
    termLabel: termLabel(term),
    totalResults: rows.length,
    position: position ? `${ordinal(position)}` : "—",
    positionNum: position,
    totalScore,
    percentage,
    gpa,
    attendancePct,
    classSize: classSize || "—",
    daysOpened,
    daysPresent,
    subjects: rows,
    strengths,
    weaknesses,
    nextTermBegins: "Monday 5th January, 2026",
    traits: traitsList,
    teacherRemark,
    principalRemark,
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
