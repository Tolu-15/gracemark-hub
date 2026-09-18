import {
  RawScores,
  ValidationResult,
  ScoreValidationIssue,
  GradeRemark,
  PRCheckpointResult,
  TRResult,
  StoredResultScores,
} from "@/types/result";

export const GRADING_CONFIG = {
  cw: { count: 10, itemMax: 10, weight: 10 },
  hw: { count: 10, itemMax: 10, weight: 5 },
  tests: { maxes: [15, 15, 30], weight: 10 },
  project: { max: 5, weight: 5 },
  exam: { max: 70, weight: 70 },
};

export function isFilled(val: any): boolean {
  return val !== null && val !== undefined && String(val).trim() !== "";
}

export function toNumber(val: any): number {
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

function padArray<T>(arr: T[], len: number, fill: T): T[] {
  const out = Array.isArray(arr) ? [...arr] : [];
  while (out.length < len) out.push(fill);
  return out.slice(0, len);
}

export function normalizeBreakdown(existing: any): RawScores {
  if (existing?.score_breakdown && typeof existing.score_breakdown === "object") {
    const b = existing.score_breakdown;
    return {
      cw: padArray(b.cw || [], GRADING_CONFIG.cw.count, ""),
      hw: padArray(b.hw || [], GRADING_CONFIG.hw.count, ""),
      tests: padArray(b.tests || [], GRADING_CONFIG.tests.maxes.length, ""),
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

export function validateRawScores(rawScores: Partial<RawScores> = {}): ValidationResult {
  const issues: ScoreValidationIssue[] = [];

  const checkList = (
    values: (number | string)[] | undefined,
    { field, itemMax, maxes }: { field: string; itemMax: number; maxes?: number[] }
  ) => {
    (values || []).forEach((val, index) => {
      if (!isFilled(val)) return;
      const num = toNumber(val);
      const max = maxes ? maxes[index] || itemMax : itemMax;
      if (!Number.isFinite(num) || num < 0 || num > max) {
        issues.push({ field, index, value: val, max });
      }
    });
  };

  checkList(rawScores.cw as any, { field: "cw", itemMax: GRADING_CONFIG.cw.itemMax });
  checkList(rawScores.hw as any, { field: "hw", itemMax: GRADING_CONFIG.hw.itemMax });
  checkList(rawScores.tests as any, { field: "tests", itemMax: 15, maxes: GRADING_CONFIG.tests.maxes });

  if (isFilled(rawScores.project)) {
    const num = toNumber(rawScores.project);
    if (!Number.isFinite(num) || num < 0 || num > GRADING_CONFIG.project.max) {
      issues.push({ field: "project", index: 0, value: rawScores.project, max: GRADING_CONFIG.project.max });
    }
  }

  if (isFilled(rawScores.exam)) {
    const num = toNumber(rawScores.exam);
    if (!Number.isFinite(num) || num < 0 || num > GRADING_CONFIG.exam.max) {
      issues.push({ field: "exam", index: 0, value: rawScores.exam, max: GRADING_CONFIG.exam.max });
    }
  }

  return { valid: issues.length === 0, issues };
}

export function isSeniorClass(className?: string): boolean {
  const c = String(className || "").trim().toUpperCase();
  return (
    (c.includes("SSS") || c.includes("SS ") || c.includes("SS1") || c.includes("SS2") || c.includes("SS3") || c.includes("SENIOR")) &&
    !c.includes("JSS") &&
    !c.includes("JUNIOR")
  );
}

export function getSeniorGradeAndRemark(score: number): GradeRemark {
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

export function getJuniorGradeAndRemark(score: number): GradeRemark {
  const s = Number(score) || 0;
  if (s >= 70) return { grade: "A", remark: "EXCELLENT" };
  if (s >= 55) return { grade: "B", remark: "VERY GOOD" };
  if (s >= 45) return { grade: "C", remark: "GOOD" };
  if (s >= 40) return { grade: "D", remark: "PASS" };
  if (s >= 30) return { grade: "E", remark: "FAIR" };
  return { grade: "F", remark: "FAIL" };
}

export function getGradeAndRemark(score: number, isSenior = false): GradeRemark {
  return isSenior ? getSeniorGradeAndRemark(score) : getJuniorGradeAndRemark(score);
}

function sliceAverage(arr: (number | string)[] | undefined, maxItems: number) {
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

export function calculatePR1(rawScores: RawScores, isSenior = false): PRCheckpointResult {
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

export function calculatePR2(rawScores: RawScores, isSenior = false): PRCheckpointResult {
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

export function calculatePR3(rawScores: RawScores, isSenior = false): PRCheckpointResult {
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

  const isSenior = options?.isSenior ?? (options?.className ? isSeniorClass(options.className) : false);
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

export function calculateStudentResult(rawScores: RawScores, config = GRADING_CONFIG, options = {}) {
  return calculateTR(rawScores, options);
}

export function toStoredScores(result: TRResult, rawScores?: RawScores): StoredResultScores {
  return {
    cw: Math.round(result.scaled.cw),
    hw: Math.round(result.scaled.hw),
    test: Math.round(result.scaled.tests),
    project: Math.round(result.scaled.project),
    exam: Math.round(result.scaled.exam),
    total: Math.round(result.totalScore),
    grade: result.grade,
    remark: result.remark,
    score_breakdown: rawScores || {
      cw: [],
      hw: [],
      tests: [],
      project: "",
      exam: "",
    },
  };
}

export function computeClassSubjectStats(resultsList: any[] = []) {
  if (!resultsList.length) {
    return { classAvg: 0, highest: 0, lowest: 0 };
  }
  const scores = resultsList
    .map((r) => Number(r.total))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!scores.length) {
    return { classAvg: 0, highest: 0, lowest: 0 };
  }

  const sum = scores.reduce((acc, curr) => acc + curr, 0);
  const classAvg = +(sum / scores.length).toFixed(1);
  const highest = Math.max(...scores);
  const lowest = Math.min(...scores);

  return { classAvg, highest, lowest };
}
