/**
 * Gracemark Academy — Grading Engine (TypeScript Port)
 * Aligned with Gracemark Master Spreadsheet Logic:
 * - CW: Weeks 1–10 (each scored /10 -> scaled avg /10)
 * - HW: Weeks 1–10 (each scored /10 -> scaled avg /5)
 * - Regular Tests: Test 1 (/15), Test 2 (/15), Test 3 (/30)
 * - Project: /5
 * - Exam: /70
 * 
 * Checkpoint Progress Reports (PR):
 * - PR1 (Week 4): Avg(CW1-4)/10 + Avg(HW1-4)/5 + Test1/15 = CA/30 (Pct = CA*10/3)
 * - PR2 (Week 7): Cumulative Avg(CW1-7)/10 + Avg(HW1-7)/5 + Avg(Test1-2)/15 = CA/30
 * - PR3 (Week 10): Cumulative Avg(CW1-10)/10 + Avg(HW1-10)/5 + Scaled Tests(T1/15, T2/15, T3/30)/15 = CA/30
 * - TR (Terminal Result): CW(/10) + HW(/5) + Tests(/10) + Project(/5) = CA/30 + Exam(/70) = Total/100
 */

export interface RawScores {
  cw: (number | string)[];
  hw: (number | string)[];
  tests: (number | string)[];
  project: number | string;
  exam: number | string;
}

export interface PRResult {
  interval: "pr1" | "pr2" | "pr3";
  label: string;
  cw: number;
  hw: number;
  test: number;
  totalCA: number;
  percentage: number;
  grade: string;
  remark: string;
  hasData: boolean;
}

export interface TRResult {
  scaled: {
    cw: number;
    hw: number;
    tests: number;
    project: number;
    exam: number;
  };
  caTotal: number;
  totalScore: number;
  grade: string;
  remark: string;
  hasData: boolean;
}

export const GRADING_CONFIG = {
  cw: { count: 10, itemMax: 10, weight: 10 },
  hw: { count: 10, itemMax: 10, weight: 5 },
  tests: { maxes: [15, 15, 30], weight: 10 },
  project: { max: 5, weight: 5 },
  exam: { max: 70, weight: 70 },
};

export function isFilled(val: unknown): boolean {
  return val !== null && val !== undefined && String(val).trim() !== "";
}

export function toNumber(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : NaN;
}

export function emptyRawScores(): RawScores {
  return {
    cw: Array(GRADING_CONFIG.cw.count).fill(""),
    hw: Array(GRADING_CONFIG.hw.count).fill(""),
    tests: Array(GRADING_CONFIG.tests.maxes.length).fill(""),
    project: "",
    exam: "",
  };
}

function padArray(arr: any[], len: number, fill: any): any[] {
  const out = Array.isArray(arr) ? [...arr] : [];
  while (out.length < len) out.push(fill);
  return out.slice(0, len);
}

export function normalizeBreakdown(existing: any): RawScores {
  if (existing?.score_breakdown && typeof existing.score_breakdown === "object") {
    const b = existing.score_breakdown;
    return {
      cw: padArray(b.cw, GRADING_CONFIG.cw.count, ""),
      hw: padArray(b.hw, GRADING_CONFIG.hw.count, ""),
      tests: padArray(b.tests, GRADING_CONFIG.tests.maxes.length, ""),
      project: b.project ?? "",
      exam: b.exam ?? "",
    };
  }

  const raw = emptyRawScores();
  if (existing?.cw !== undefined && existing?.cw !== null) raw.cw[0] = existing.cw;
  if (existing?.hw !== undefined && existing?.hw !== null) raw.hw[0] = existing.hw;
  if (existing?.test !== undefined && existing?.test !== null) raw.tests[0] = existing.test;
  if (existing?.project !== undefined && existing?.project !== null) raw.project = existing.project;
  if (existing?.exam !== undefined && existing?.exam !== null) raw.exam = existing.exam;
  return raw;
}

export function validateRawScores(rawScores: Partial<RawScores> = {}) {
  const issues: { field: string; index: number; value: any; max: number }[] = [];

  const checkList = (
    values: any[] | undefined,
    { field, itemMax, maxes }: { field: string; itemMax?: number; maxes?: number[] }
  ) => {
    (values || []).forEach((val, index) => {
      if (!isFilled(val)) return;
      const num = toNumber(val);
      const max = maxes ? maxes[index] || itemMax || 10 : itemMax || 10;
      if (!Number.isFinite(num) || num < 0 || num > max) {
        issues.push({ field, index, value: val, max });
      }
    });
  };

  checkList(rawScores.cw, { field: "cw", itemMax: GRADING_CONFIG.cw.itemMax });
  checkList(rawScores.hw, { field: "hw", itemMax: GRADING_CONFIG.hw.itemMax });
  checkList(rawScores.tests, { field: "tests", maxes: GRADING_CONFIG.tests.maxes });

  if (isFilled(rawScores.project)) {
    const num = toNumber(rawScores.project);
    if (!Number.isFinite(num) || num < 0 || num > GRADING_CONFIG.project.max) {
      issues.push({
        field: "project",
        index: 0,
        value: rawScores.project,
        max: GRADING_CONFIG.project.max,
      });
    }
  }

  if (isFilled(rawScores.exam)) {
    const num = toNumber(rawScores.exam);
    if (!Number.isFinite(num) || num < 0 || num > GRADING_CONFIG.exam.max) {
      issues.push({
        field: "exam",
        index: 0,
        value: rawScores.exam,
        max: GRADING_CONFIG.exam.max,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

export function isSeniorClass(className?: string): boolean {
  const c = String(className || "").trim().toUpperCase();
  return (
    (c.includes("SSS") ||
      c.includes("SS ") ||
      c.includes("SS1") ||
      c.includes("SS2") ||
      c.includes("SS3") ||
      c.includes("SENIOR")) &&
    !c.includes("JSS") &&
    !c.includes("JUNIOR")
  );
}

export function getSeniorGradeAndRemark(score: number | string): { grade: string; remark: string } {
  const s = Number(score) || 0;
  if (s >= 75) return { grade: "A1", remark: "EXCELLENT" };
  if (s >= 70) return { grade: "B2", remark: "VERY GOOD" };
  if (s >= 65) return { grade: "B3", remark: "GOOD" };
  if (s >= 60) return { grade: "C4", remark: "CREDIT" };
  if (s >= 55) return { grade: "C5", remark: "CREDIT" };
  if (s >= 50) return { grade: "C6", remark: "CREDIT" };
  if (s >= 45) return { grade: "D7", remark: "PASS" };
  if (s >= 40) return { grade: "E8", remark: "PASS" };
  return { grade: "F9", remark: "FAIL" };
}

export function getJuniorGradeAndRemark(score: number | string): { grade: string; remark: string } {
  const s = Number(score) || 0;
  if (s >= 70) return { grade: "A", remark: "EXCELLENT" };
  if (s >= 55) return { grade: "B", remark: "VERY GOOD" };
  if (s >= 45) return { grade: "C", remark: "GOOD" };
  if (s >= 40) return { grade: "D", remark: "PASS" };
  if (s >= 30) return { grade: "E", remark: "FAIR" };
  return { grade: "F", remark: "FAIL" };
}

export function getGradeAndRemark(score: number | string, isSenior = false) {
  return isSenior ? getSeniorGradeAndRemark(score) : getJuniorGradeAndRemark(score);
}

function sliceAverage(arr?: any[], maxItems = 10) {
  if (!Array.isArray(arr)) return { avg: 0, count: 0, sum: 0 };
  let sum = 0;
  let count = 0;
  const limit = Math.min(arr.length, maxItems);
  for (let i = 0; i < limit; i++) {
    const val = arr[i];
    if (isFilled(val)) {
      const n = toNumber(val);
      if (Number.isFinite(n)) {
        sum += n;
        count++;
      }
    }
  }
  return {
    avg: count > 0 ? +(sum / count).toFixed(2) : 0,
    count,
    sum,
  };
}

export function calculatePR1(rawScores: RawScores, isSenior = false): PRResult {
  const cwStats = sliceAverage(rawScores.cw, 4);
  const hwStats = sliceAverage(rawScores.hw, 4);
  const cwScore = cwStats.avg;
  const hwScore = +(hwStats.avg * 0.5).toFixed(2);
  const test1Val = isFilled(rawScores.tests?.[0]) ? toNumber(rawScores.tests[0]) : 0;
  const testScore = Number.isFinite(test1Val) ? Math.min(Math.max(0, test1Val), 15) : 0;

  const totalCA = +(cwScore + hwScore + testScore).toFixed(2);
  const percentage = +(totalCA * (10 / 3)).toFixed(1);
  const { grade, remark } = getGradeAndRemark(percentage, isSenior);

  return {
    interval: "pr1",
    label: "Week 4 Progress Report",
    cw: cwScore,
    hw: hwScore,
    test: testScore,
    totalCA,
    percentage,
    grade,
    remark,
    hasData: cwStats.count > 0 || hwStats.count > 0 || isFilled(rawScores.tests?.[0]),
  };
}

export function calculatePR2(rawScores: RawScores, isSenior = false): PRResult {
  const cwStats = sliceAverage(rawScores.cw, 7);
  const hwStats = sliceAverage(rawScores.hw, 7);
  const cwScore = cwStats.avg;
  const hwScore = +(hwStats.avg * 0.5).toFixed(2);

  let testSum = 0;
  let testMaxSum = 0;
  let testCount = 0;
  const testMaxes = GRADING_CONFIG.tests.maxes;
  for (let i = 0; i < 2; i++) {
    const val = rawScores.tests?.[i];
    if (isFilled(val)) {
      const n = toNumber(val);
      const max = testMaxes[i] || 15;
      if (Number.isFinite(n)) {
        testSum += Math.min(Math.max(0, n), max);
        testMaxSum += max;
        testCount++;
      }
    }
  }
  const testScore = testMaxSum > 0 ? +((testSum / testMaxSum) * 15).toFixed(2) : 0;

  const totalCA = +(cwScore + hwScore + testScore).toFixed(2);
  const percentage = +(totalCA * (10 / 3)).toFixed(1);
  const { grade, remark } = getGradeAndRemark(percentage, isSenior);

  return {
    interval: "pr2",
    label: "Week 7 Progress Report",
    cw: cwScore,
    hw: hwScore,
    test: testScore,
    totalCA,
    percentage,
    grade,
    remark,
    hasData: cwStats.count > 0 || hwStats.count > 0 || testCount > 0,
  };
}

export function calculatePR3(rawScores: RawScores, isSenior = false): PRResult {
  const cwStats = sliceAverage(rawScores.cw, 10);
  const hwStats = sliceAverage(rawScores.hw, 10);
  const cwScore = cwStats.avg;
  const hwScore = +(hwStats.avg * 0.5).toFixed(2);

  let testSum = 0;
  let testMaxSum = 0;
  let testCount = 0;
  const testMaxes = GRADING_CONFIG.tests.maxes;
  for (let i = 0; i < 3; i++) {
    const val = rawScores.tests?.[i];
    if (isFilled(val)) {
      const n = toNumber(val);
      const max = testMaxes[i] || 15;
      if (Number.isFinite(n)) {
        testSum += Math.min(Math.max(0, n), max);
        testMaxSum += max;
        testCount++;
      }
    }
  }
  const testScore = testMaxSum > 0 ? +((testSum / testMaxSum) * 15).toFixed(2) : 0;

  const totalCA = +(cwScore + hwScore + testScore).toFixed(2);
  const percentage = +(totalCA * (10 / 3)).toFixed(1);
  const { grade, remark } = getGradeAndRemark(percentage, isSenior);

  return {
    interval: "pr3",
    label: "Week 10 Progress Report",
    cw: cwScore,
    hw: hwScore,
    test: testScore,
    totalCA,
    percentage,
    grade,
    remark,
    hasData: cwStats.count > 0 || hwStats.count > 0 || testCount > 0,
  };
}

export function calculateTR(
  rawScores: RawScores,
  options: { isSenior?: boolean; className?: string } = {}
): TRResult {
  const cwStats = sliceAverage(rawScores.cw, 10);
  const hwStats = sliceAverage(rawScores.hw, 10);
  const cwScore = cwStats.avg;
  const hwScore = +(hwStats.avg * 0.5).toFixed(2);

  let testSum = 0;
  let testMaxSum = 0;
  let testCount = 0;
  const testMaxes = GRADING_CONFIG.tests.maxes;
  (rawScores.tests || []).forEach((val, i) => {
    if (isFilled(val)) {
      const n = toNumber(val);
      const max = testMaxes[i] || 15;
      if (Number.isFinite(n)) {
        testSum += Math.min(Math.max(0, n), max);
        testMaxSum += max;
        testCount++;
      }
    }
  });
  const testScore = testMaxSum > 0 ? +((testSum / testMaxSum) * 10).toFixed(2) : 0;

  const prjVal = isFilled(rawScores.project) ? toNumber(rawScores.project) : 0;
  const projectScore = Number.isFinite(prjVal) ? Math.min(Math.max(0, prjVal), 5) : 0;

  const examVal = isFilled(rawScores.exam) ? toNumber(rawScores.exam) : 0;
  const examScore = Number.isFinite(examVal) ? Math.min(Math.max(0, examVal), 70) : 0;

  const caTotal = +(cwScore + hwScore + testScore + projectScore).toFixed(2);
  const totalScore = +(caTotal + examScore).toFixed(2);

  const isSenior =
    options?.isSenior ?? (options?.className ? isSeniorClass(options.className) : false);
  const { grade, remark } = getGradeAndRemark(totalScore, isSenior);

  return {
    scaled: {
      cw: cwScore,
      hw: hwScore,
      tests: testScore,
      project: projectScore,
      exam: examScore,
    },
    caTotal,
    totalScore,
    grade,
    remark,
    hasData:
      cwStats.count > 0 ||
      hwStats.count > 0 ||
      testCount > 0 ||
      isFilled(rawScores.project) ||
      isFilled(rawScores.exam),
  };
}

export function calculateStudentResult(
  rawScores: RawScores,
  _config = GRADING_CONFIG,
  options = {}
) {
  return calculateTR(rawScores, options);
}

export function toStoredScores(result: TRResult) {
  return {
    cw: Math.round(result.scaled.cw),
    hw: Math.round(result.scaled.hw),
    test: Math.round(result.scaled.tests),
    project: Math.round(result.scaled.project),
    exam: Math.round(result.scaled.exam),
    total: Math.round(result.totalScore),
    grade: result.grade,
  };
}

export function computeClassSubjectStats(
  classResults: any[] = [],
  milestone = "TR"
): Record<string, { avg: number; lowest: number; highest: number; count: number }> {
  const bySubject: Record<string, number[]> = {};

  (classResults || []).forEach((row) => {
    const subjId = row.subject_id;
    if (!subjId) return;

    let score = 0;
    if (milestone === "PR1") {
      const raw = normalizeBreakdown(row);
      score = calculatePR1(raw).percentage;
    } else if (milestone === "PR2") {
      const raw = normalizeBreakdown(row);
      score = calculatePR2(raw).percentage;
    } else if (milestone === "PR3") {
      const raw = normalizeBreakdown(row);
      score = calculatePR3(raw).percentage;
    } else {
      score = Number(row.total) || 0;
    }

    if (!bySubject[subjId]) {
      bySubject[subjId] = [];
    }
    bySubject[subjId].push(score);
  });

  const stats: Record<string, { avg: number; lowest: number; highest: number; count: number }> = {};
  for (const [subjId, scores] of Object.entries(bySubject)) {
    if (!scores.length) continue;
    const sum = scores.reduce((a, b) => a + b, 0);
    const avg = +(sum / scores.length).toFixed(1);
    const lowest = Math.min(...scores);
    const highest = Math.max(...scores);
    stats[subjId] = {
      avg,
      lowest,
      highest,
      count: scores.length,
    };
  }

  return stats;
}
