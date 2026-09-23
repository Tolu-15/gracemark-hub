import { getSupabaseBrowserClient } from "./supabase/client";
import {
  normalizeBreakdown,
  calculateStudentResult,
  isSeniorClass,
  getGradeAndRemark,
  calculatePR1,
  calculatePR2,
  calculatePR3,
} from "./gradingEngine";

export const TERM_OPTIONS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

export const PR_INTERVALS = [
  { value: "pr1", label: "PR 1 (Weeks 1 – 4)", shortLabel: "PR 1", weeks: "Weeks 1 – 4", checkpoint: "Week 4", testIndex: 0 },
  { value: "pr2", label: "PR 2 (Weeks 1 – 7)", shortLabel: "PR 2", weeks: "Weeks 1 – 7", checkpoint: "Week 7", testIndex: 1 },
  { value: "pr3", label: "PR 3 (Weeks 1 – 10)", shortLabel: "PR 3", weeks: "Weeks 1 – 10", checkpoint: "Week 10", testIndex: 2 },
];

export function termLabel(term: string) {
  return TERM_OPTIONS.find((t) => t.value === term)?.label ?? term;
}

export function gradeToRemark(grade: string | null | undefined): string {
  const g = String(grade || "").toUpperCase();
  if (g === "A1" || g === "A") return "EXCELLENT";
  if (g === "B2") return "VERY GOOD";
  if (g === "B3" || g === "B") return "GOOD";
  if (g === "C4" || g === "C5" || g === "C6") return "CREDIT";
  if (g === "C") return "SATISFACTORY";
  if (g === "D7" || g === "E8") return "PASS";
  if (g === "D") return "WEAK";
  if (g === "F9" || g === "F") return "FAIL";
  return "NEEDS IMPROVEMENT";
}

export function buildPrincipalRemark(report: { percentage?: number; totalScore?: number }): string {
  const pct = Number(report.percentage ?? report.totalScore ?? 0);
  if (pct >= 80) return "THIS IS AN OUTSTANDING RESULT. KEEP IT UP!";
  if (pct >= 70) return "THIS IS A VERY GOOD RESULT. KEEP IT UP!";
  if (pct >= 60) return "THIS IS A GOOD RESULT. THERE IS STILL ROOM FOR IMPROVEMENT.";
  if (pct >= 50) return "A FAIR RESULT. MORE EFFORT IS REQUIRED FOR BETTER PERFORMANCE.";
  if (pct >= 40) return "THIS IS A WEAK RESULT. THERE IS A PRESSING NEED FOR IMPROVEMENT.";
  return "POOR PERFORMANCE. SERIOUS DEDICATION AND INTERVENTION REQUIRED.";
}

export function getPromotionStatus(report: { className?: string; percentage?: number }) {
  const { className, percentage } = report;
  const cName = String(className || "").trim().toUpperCase();
  const isSenior =
    (cName.includes("SSS") ||
      cName.includes("SS ") ||
      cName.includes("SS1") ||
      cName.includes("SS2") ||
      cName.includes("SS3") ||
      cName.includes("SENIOR")) &&
    !cName.includes("JSS") &&
    !cName.includes("JUNIOR");

  const pct = Number(percentage) || 0;

  if (isSenior) {
    const nextClass = cName.includes("1") ? "SSS 2" : cName.includes("2") ? "SSS 3" : "GRADUATED";
    const currentClass = cName.includes("1") ? "SSS 1" : cName.includes("2") ? "SSS 2" : "SSS 3";
    if (pct >= 50) return { status: "PROMOTED", text: `PROMOTED TO ${nextClass}`, code: "success" };
    if (pct >= 45) return { status: "TRIAL", text: `PROMOTED TO ${nextClass} ON TRIAL`, code: "warning" };
    return { status: "REPEAT", text: `TO REPEAT ${currentClass}`, code: "danger" };
  } else {
    const nextClass = cName.includes("1") ? "JSS 2" : cName.includes("2") ? "JSS 3" : "SSS 1";
    const currentClass = cName.includes("1") ? "JSS 1" : cName.includes("2") ? "JSS 2" : "JSS 3";
    if (pct >= 50) return { status: "PROMOTED", text: `PROMOTED TO ${nextClass}`, code: "success" };
    if (pct >= 40)
      return {
        status: "TRIAL",
        text: `PROMOTED TO ${nextClass} ON TRIAL, BUT MUST ATTEND INTERVENTION CLASS.`,
        code: "warning",
      };
    return { status: "REPEAT", text: `TO REPEAT ${currentClass}`, code: "danger" };
  }
}

export const EXCEL_PERSONAL_SKILLS = [
  "Punctuality",
  "Concentration in Class",
  "Contribution in Class",
  "Organisational Skill",
  "Handwriting",
  "Fluency",
  "Games/Sports",
  "Neatness",
  "Teamwork",
  "Leadership",
  "Interpersonal Skills",
  "Initiative",
];

export function buildTraits(report: { percentage?: number; attendancePct?: number }) {
  const pct = Number(report.percentage) || 0;
  const attendancePct = report.attendancePct ?? 80;
  const base = attendancePct >= 85 ? 5 : attendancePct >= 70 ? 4 : 3;
  const perfBoost = pct >= 70 ? 1 : pct >= 50 ? 0 : -1;

  return EXCEL_PERSONAL_SKILLS.map((name, i) => {
    let score = base + (i % 3 === 0 ? perfBoost : 0);
    if (name === "Handwriting" && pct < 50) score -= 1;
    if (name === "Leadership" && pct >= 65) score += 1;
    score = Math.max(2, Math.min(5, score));
    return { name, score, max: 5 };
  });
}

export function generateAiInsight(report: any): string {
  const {
    studentName,
    className,
    termLabel,
    session,
    percentage,
    position,
    classSize,
    attendancePct,
    subjects,
    strengths,
    weaknesses,
  } = report;

  const name = studentName || "The student";
  const term = termLabel || "this term";
  const sessionText = session ? ` (${session})` : "";

  let intro = `${name} is enrolled in ${className || "their class"} for ${term}${sessionText}. `;
  intro += `With an overall average of ${percentage}%, `;
  intro +=
    position && classSize
      ? `they currently rank ${position} out of ${classSize} learners in academic performance. `
      : `their academic performance reflects steady engagement across approved subjects. `;

  let attendance = "";
  if (attendancePct >= 90) {
    attendance = "Attendance is outstanding and supports consistent classroom participation. ";
  } else if (attendancePct >= 75) {
    attendance = "Attendance is satisfactory, though maintaining regular presence will strengthen outcomes further. ";
  } else {
    attendance = "Attendance needs improvement; more consistent presence is likely to lift scores in upcoming assessments. ";
  }

  let subjectsText = "";
  if (strengths?.length) {
    subjectsText += `Notable strengths appear in ${strengths.join(", ")}. `;
  }
  if (weaknesses?.length) {
    subjectsText += `Additional focus is recommended in ${weaknesses.join(", ")} to improve overall academic standing. `;
  }

  const consistency =
    subjects && subjects.length >= 4 && percentage >= 70
      ? "Performance shows commendable consistency across multiple subjects."
      : subjects && subjects.length >= 2
      ? "Results show varying performance; targeted revision will help stabilise grades."
      : "Limited approved results are available; more published scores will refine this analysis.";

  const suggestion =
    percentage >= 75
      ? "Continue excellent study habits, practice past questions weekly, and maintain momentum."
      : percentage >= 50
      ? "Increase weekly revision time, complete all assignments on schedule, and seek teacher guidance after tests."
      : "Adopt a structured study plan, attend remedial sessions, and prioritise weak topics with regular practice.";

  return `${intro}${attendance}${subjectsText}${consistency} ${suggestion}`;
}

function computePrForInterval(raw: any, fallbackScores: any, testIndex: number, isSenior: boolean) {
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

  // Fallback for legacy single CA scores
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

export async function fetchStudentReport({
  student,
  term,
  session,
  historicalClassId,
  historicalClassName,
}: {
  student: any;
  term: string;
  session: string;
  historicalClassId?: string;
  historicalClassName?: string;
}) {
  if (!student?.id) throw new Error("Student profile not loaded.");

  const supabase = getSupabaseBrowserClient();

  // 1. Resolve true session-specific class from parameters, enrollments, or historical results
  let classId = historicalClassId || student.class_id;
  let className = historicalClassName || (student.classes?.name ?? "—");

  if (!historicalClassName && session) {
    try {
      const { data: enrollment } = await supabase
        .from("student_enrollments")
        .select("class_id, classes(id, name)")
        .eq("student_id", student.id)
        .eq("session", session)
        .maybeSingle();

      if (enrollment?.class_id) {
        classId = enrollment.class_id;
        if ((enrollment as any).classes?.name) {
          className = (enrollment as any).classes.name;
        }
      } else {
        // Fallback: check historical class recorded in results for this session
        const { data: resClass } = await supabase
          .from("results")
          .select("class_id, classes(id, name)")
          .eq("student_id", student.id)
          .eq("session", session)
          .limit(1)
          .maybeSingle();

        if (resClass?.class_id) {
          classId = resClass.class_id;
          if ((resClass as any).classes?.name) {
            className = (resClass as any).classes.name;
          }
        }
      }
    } catch (e) {
      console.warn("Could not load session enrollment for report, using default class:", e);
    }
  }

  const isSenior = isSeniorClass(className);


  // 2. Fetch published snapshots for this student, term, and session
  const publishedMilestones = {
    pr1: false,
    pr2: false,
    pr3: false,
    tr: false,
  };
  const publishedSnapshotsMap: Record<string, any> = {};

  try {
    let snapQuery = supabase
      .from("published_snapshots")
      .select("report_type, snapshot_data, session, term")
      .eq("student_id", student.id)
      .eq("term", term);
    if (session) snapQuery = snapQuery.eq("session", session);

    let { data: snaps } = await snapQuery;
    if ((!snaps || snaps.length === 0) && session) {
      const fbSnap = await supabase
        .from("published_snapshots")
        .select("report_type, snapshot_data, session, term")
        .eq("student_id", student.id)
        .eq("term", term);
      if (fbSnap.data && fbSnap.data.length > 0) {
        snaps = fbSnap.data;
      }
    }

    (snaps || []).forEach((s: any) => {
      const type = String(s.report_type || "").toLowerCase();
      if (type === "pr1") {
        publishedMilestones.pr1 = true;
        publishedSnapshotsMap.pr1 = s.snapshot_data;
      } else if (type === "pr2") {
        publishedMilestones.pr2 = true;
        publishedSnapshotsMap.pr2 = s.snapshot_data;
      } else if (type === "pr3") {
        publishedMilestones.pr3 = true;
        publishedSnapshotsMap.pr3 = s.snapshot_data;
      } else if (type === "tr") {
        publishedMilestones.tr = true;
        publishedSnapshotsMap.tr = s.snapshot_data;
      }
    });
  } catch (snapErr) {
    console.warn("Could not fetch published_snapshots:", snapErr);
  }

  let resultsQuery = supabase
    .from("results")
    .select("id, subject_id, cw, hw, test, project, exam, total, grade, status, pr1_status, pr2_status, pr3_status, tr_status, score_breakdown, subjects(name)")
    .eq("student_id", student.id)
    .eq("term", term);

  if (session) {
    resultsQuery = resultsQuery.eq("session", session);
  }

  let results: any = null;
  let error: any = null;
  const resQueryResult = await resultsQuery;
  results = resQueryResult.data;
  error = resQueryResult.error;

  if (error && /score_breakdown|session|pr1_status|pr2_status|pr3_status|tr_status/i.test(error.message || "")) {
    let fallbackQuery = supabase
      .from("results")
      .select("id, subject_id, cw, hw, test, project, exam, total, grade, status, subjects(name)")
      .eq("student_id", student.id)
      .eq("term", term);
    if (session) fallbackQuery = fallbackQuery.eq("session", session);
    const fbRes = await fallbackQuery;
    results = fbRes.data;
    error = fbRes.error;
  }
  if (error) throw error;

  // Check if results rows have explicit published statuses for each milestone
  (results || []).forEach((r: any) => {
    if (r.pr1_status === "published") publishedMilestones.pr1 = true;
    if (r.pr2_status === "published") publishedMilestones.pr2 = true;
    if (r.pr3_status === "published") publishedMilestones.pr3 = true;
    if (r.tr_status === "published") publishedMilestones.tr = true;
  });

  // Fetch all approved results for the session for cumulative averages (Term 3)
  let allSessionQuery = supabase
    .from("results")
    .select("subject_id, term, total")
    .eq("student_id", student.id)
    .eq("status", "approved");
  if (session) allSessionQuery = allSessionQuery.eq("session", session);

  const { data: allSessionResults } = await allSessionQuery;

  const sessionResultsMap = new Map<string, Record<string, number>>();
  (allSessionResults || []).forEach((r: any) => {
    if (!sessionResultsMap.has(r.subject_id)) {
      sessionResultsMap.set(r.subject_id, {});
    }
    sessionResultsMap.get(r.subject_id)![r.term] = Number(r.total) || 0;
  });

  // Single Source of Truth: Only process rows that are officially PUBLISHED (never raw drafts or unapproved records)
  const publishedResults = (results ?? []).filter((row: any) => {
    return (
      row.status === "published" ||
      row.tr_status === "published" ||
      row.pr1_status === "published" ||
      row.pr2_status === "published" ||
      row.pr3_status === "published"
    );
  });

  let rows = publishedResults.map((row: any) => {
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

    let annualAverage: number | null = null;
    if (term === "term3") {
      let sum = 0;
      let count = 0;
      if (term1_total !== null && term1_total !== undefined) { sum += term1_total; count++; }
      if (term2_total !== null && term2_total !== undefined) { sum += term2_total; count++; }
      if (term3_total !== null && term3_total !== undefined) { sum += term3_total; count++; }
      annualAverage = count > 0 ? +(sum / count).toFixed(1) : currentTermTotal;
    }

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
      grade: row.grade && term !== "term3" ? row.grade : computed.grade,
      remark: row.grade && term !== "term3" ? gradeToRemark(row.grade) : computed.remark,
      pr: pr1,
      prs: { pr1, pr2, pr3 },
      classAverage: null as any,
      high: null as any,
      low: null as any,
    };
  });

  // Snapshots are retained strictly for immutable historical export and offline viewing, not as a publication gating bypass.

  // Include any enrolled subjects from student_subject_enrollments that do not have an approved result yet
  try {
    let sseQuery = supabase
      .from("student_subject_enrollments")
      .select("subject_id, subjects(name)")
      .eq("student_id", student.id)
      .eq("status", "enrolled");

    if (session) {
      sseQuery = sseQuery.eq("session", session);
    }

    const { data: enrolledData } = await sseQuery;
    if (enrolledData && enrolledData.length > 0) {
      const existingSubIds = new Set(rows.map((r: any) => r.subjectId));
      enrolledData.forEach((ed: any) => {
        if (!existingSubIds.has(ed.subject_id)) {
          const subName = ed.subjects?.name || "Subject";
          rows.push({
            subject: subName,
            subjectId: ed.subject_id,
            cw: null,
            hw: null,
            test: null,
            project: null,
            exam: null,
            total: null,
            term1_total: null,
            term2_total: null,
            term3_total: null,
            annualAverage: null,
            grade: "—",
            remark: "Pending Evaluation",
            pr: { cw: "—", hw: "—", test: "—", totalCa: "—", percentage: "—", grade: "—", status: "Pending" },
            prs: {
              pr1: { cw: "—", hw: "—", test: "—", totalCa: "—", percentage: "—", grade: "—", status: "Pending" },
              pr2: { cw: "—", hw: "—", test: "—", totalCa: "—", percentage: "—", grade: "—", status: "Pending" },
              pr3: { cw: "—", hw: "—", test: "—", totalCa: "—", percentage: "—", grade: "—", status: "Pending" },
            },
            classAverage: "—",
            high: "—",
            low: "—",
            isUnevaluated: true,
          });
        }
      });
    }
  } catch (sseErr) {
    console.warn("Could not fetch enrolled subjects:", sseErr);
  }

  rows.sort((a: any, b: any) => a.subject.localeCompare(b.subject));

  let classSize = 0;
  let position: number | null = null;
  let averagesMap = new Map<string, any>();

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
      console.warn("Could not fetch class benchmarks:", benchErr);
    }
  }

  rows.forEach((r: any) => {
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

  let attQuery = supabase
    .from("attendance")
    .select("times_opened, times_present, times_absent")
    .eq("student_id", student.id)
    .eq("term", term);
  if (session) attQuery = attQuery.eq("session", session);

  let { data: attendance } = await attQuery.maybeSingle();

  let timesPresent = attendance?.times_present;
  let timesOpened = attendance?.times_opened;
  let timesAbsent = attendance?.times_absent;

  // If no attendance row recorded yet, dynamically calculate from daily register
  if (timesPresent === undefined || timesPresent === null) {
    try {
      let drQuery = supabase
        .from("attendance_records")
        .select("am_present, pm_present, date")
        .eq("student_id", student.id)
        .eq("term", term);
      if (session) drQuery = drQuery.eq("session", session);

      const { data: dailyRecords } = await drQuery;
      if (dailyRecords && dailyRecords.length > 0) {
        let presCount = 0;
        const datesSet = new Set<string>();
        dailyRecords.forEach((dr) => {
          datesSet.add(dr.date);
          if (dr.am_present) presCount++;
          if (dr.pm_present) presCount++;
        });
        timesPresent = presCount;
        timesOpened = Math.max(120, datesSet.size * 2);
        timesAbsent = Math.max(0, timesOpened - timesPresent);
      }
    } catch {
      // fallback
    }
  }

  timesOpened = timesOpened || 120;
  timesPresent = timesPresent ?? 0;
  timesAbsent = timesAbsent ?? Math.max(0, timesOpened - timesPresent);
  const daysOpened = Math.round(timesOpened / 2);
  const daysPresent = Math.round(timesPresent / 2);
  const attendancePct = timesOpened > 0 ? Math.round((timesPresent / timesOpened) * 100) : 100;

  // Calculate sum and average strictly over evaluated subjects (NULL/missing excluded, explicit 0 included)
  const evaluatedRows = rows.filter(
    (r: any) => r.total !== null && r.total !== undefined && Number.isFinite(Number(r.total))
  );

  const sumOfScores = evaluatedRows.reduce((s: number, r: any) => {
    const val = term === "term3" && r.annualAverage !== null ? r.annualAverage : Number(r.total);
    return s + val;
  }, 0);

  const evaluatedCount = evaluatedRows.length;
  const overallTotal = evaluatedCount > 0 ? +sumOfScores.toFixed(1) : 0;
  const percentage = evaluatedCount > 0 ? +(sumOfScores / evaluatedCount).toFixed(1) : 0;

  const strengths = evaluatedRows
    .filter((r: any) => {
      const g = String(r.grade || "").toUpperCase();
      return g === "A" || g === "B" || g === "A1" || g === "B2" || g === "B3";
    })
    .map((r: any) => r.subject);

  const weaknesses = evaluatedRows
    .filter((r: any) => {
      const g = String(r.grade || "").toUpperCase();
      return g === "D" || g === "F" || g === "D7" || g === "E8" || g === "F9";
    })
    .map((r: any) => r.subject);

  // Fetch Evaluations
  const { data: evaluation } = await supabase
    .from("student_evaluations")
    .select("*")
    .eq("student_id", student.id)
    .eq("term", term)
    .eq("session", session)
    .maybeSingle();

  // Fetch Principal Signature Stamp & Resumption Date from school_settings
  const { data: schoolSettings } = await supabase
    .from("school_settings")
    .select("principal_signature_url, next_term_resumption_date")
    .maybeSingle();

  const reportData = {
    studentId: student.id,
    studentName: student.name,
    admissionNo: student.admission_no,
    className,
    isSenior,
    term,
    termLabel: termLabel(term),
    session,
    overallTotal,
    percentage,
    classSize,
    position,
    subjects: rows,
    strengths,
    weaknesses,
    attendance: {
      timesOpened,
      timesPresent,
      timesAbsent,
      daysOpened,
      daysPresent,
      attendancePct,
    },
    attendancePct,
    evaluations: evaluation,
    teacherRemark: evaluation?.teacher_remark || (rows.length > 0 ? "Pleasant and well-behaved pupil." : "—"),
    principalRemark: evaluation?.principal_remark || buildPrincipalRemark({ percentage }),
    principalSignatureUrl: schoolSettings?.principal_signature_url || "/assets/signatures/principal.png",
    resumptionDate: schoolSettings?.next_term_resumption_date || "To be announced",
    promotion: term === "term3" ? getPromotionStatus({ className, percentage }) : null,
    publishedMilestones,
  };

  return {
    ...reportData,
    aiInsight: generateAiInsight(reportData),
    traits: buildTraits(reportData),
  };
}
