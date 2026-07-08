import { supabase } from "/js/shared/supabaseClient.js";
import { getLatestAppSettings } from "/js/shared/appSettings.js";
import { normalizeBreakdown, calculateStudentResult } from "/shared/gradingEngine.js";
import { gradeToGpaPoint, gradeToRemark, buildPrincipalRemark, buildTraits, generateAiInsight } from "./insight.js";

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

  let { data: results, error } = await resultsQuery;
  if (error && /score_breakdown/i.test(error.message || "")) {
    ({ data: results, error } = await supabase
      .from("results")
      .select("id, subject_id, cw, hw, test, project, exam, total, grade, subjects(name)")
      .eq("student_id", student.id)
      .eq("term", term)
      .eq("status", "approved"));
  }
  if (error) throw error;

  const rows = (results ?? []).map((row) => {
    const raw = normalizeBreakdown(row);
    const computed = calculateStudentResult(raw);
    const subjectName = row.subjects?.name ?? "Subject";
    return {
      subject: subjectName,
      subjectId: row.subject_id,
      hw: Math.round(row.hw ?? computed.scaled.hw),
      test: Math.round(row.test ?? computed.scaled.tests),
      project: Math.round(row.project ?? computed.scaled.project),
      exam: Math.round(row.exam ?? computed.scaled.exam),
      total: Math.round(row.total ?? computed.totalScore),
      grade: row.grade ?? computed.grade,
      remark: gradeToRemark(row.grade ?? computed.grade),
      unit: 1,
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
  const gpa =
    rows.length > 0
      ? rows.reduce((s, r) => s + gradeToGpaPoint(r.grade), 0) / rows.length
      : 0;
  const percentage = totalScore;

  const strengths = rows.filter((r) => r.grade === "A" || r.grade === "B").map((r) => r.subject);
  const weaknesses = rows.filter((r) => r.grade === "D" || r.grade === "F").map((r) => r.subject);

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
    gpa,
    totalScore,
    percentage,
    attendancePct,
    classSize: classSize || "—",
    daysOpened,
    daysPresent,
    subjects: rows,
    strengths,
    weaknesses,
    nextTermBegins: "Monday 5th January, 2026",
  };

  report.aiInsight = generateAiInsight(report);
  report.principalRemark = buildPrincipalRemark(report);
  report.traits = buildTraits(report);

  return report;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export async function loadSessions() {
  const settings = await getLatestAppSettings();
  const session = settings?.current_session?.trim();
  return session ? [session] : ["2024/2025", "2025/2026"];
}

export { TERM_OPTIONS };
