/**
 * Gracemark Academy — grading engine
 * CW×5 (10 each → avg /10), HW×5 (10 each → avg /5),
 * Tests×3 (15+15+30 → avg /10), Project /5, Exam /70 → Total /100
 */

export const GRADING_CONFIG = {
  cw: { count: 5, itemMax: 10, weight: 10 },
  hw: { count: 5, itemMax: 10, weight: 5 },
  tests: { maxes: [15, 15, 30], weight: 10 },
  project: { max: 5, weight: 5 },
  exam: { max: 70, weight: 70 },
};

function isFilled(val) {
  return val !== null && val !== undefined && String(val).trim() !== "";
}

function toNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : NaN;
}

export function emptyRawScores() {
  return {
    cw: Array(GRADING_CONFIG.cw.count).fill(""),
    hw: Array(GRADING_CONFIG.hw.count).fill(""),
    tests: Array(GRADING_CONFIG.tests.maxes.length).fill(""),
    project: "",
    exam: "",
  };
}

export function normalizeBreakdown(existing) {
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
  if (existing?.cw) raw.cw[0] = existing.cw;
  if (existing?.hw) raw.hw[0] = existing.hw;
  if (existing?.test) raw.tests[0] = existing.test;
  if (existing?.project !== undefined && existing?.project !== null) raw.project = existing.project;
  if (existing?.exam !== undefined && existing?.exam !== null) raw.exam = existing.exam;
  return raw;
}

function padArray(arr, len, fill) {
  const out = Array.isArray(arr) ? [...arr] : [];
  while (out.length < len) out.push(fill);
  return out.slice(0, len);
}

export function validateRawScores(rawScores = {}) {
  const issues = [];

  const checkList = (values, { field, itemMax, maxes }) => {
    (values || []).forEach((val, index) => {
      if (!isFilled(val)) return;
      const num = toNumber(val);
      const max = maxes ? maxes[index] : itemMax;
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

export function calculateStudentResult(rawScores, config = GRADING_CONFIG) {
  const calculateScaledAverage = (arr, constraints) => {
    if (!Array.isArray(arr)) return 0;

    let sum = 0;
    let maxSum = 0;

    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];
      if (!isFilled(val)) continue;
      const num = toNumber(val);
      if (!Number.isFinite(num)) continue;
      const itemMax = constraints.maxes ? constraints.maxes[i] : constraints.itemMax ?? constraints.max;
      sum += num;
      maxSum += itemMax;
    }

    if (maxSum === 0) return 0;
    return (sum / maxSum) * constraints.weight;
  };

  const getSingleScaled = (val, constraints) => {
    if (!isFilled(val)) return 0;
    const num = toNumber(val);
    if (!Number.isFinite(num)) return 0;
    return (num / constraints.max) * constraints.weight;
  };

  const cwScaled = calculateScaledAverage(rawScores.cw, config.cw);
  const hwScaled = calculateScaledAverage(rawScores.hw, config.hw);
  const testsScaled = calculateScaledAverage(rawScores.tests, config.tests);
  const projectScaled = getSingleScaled(rawScores.project, config.project);
  const examScaled = getSingleScaled(rawScores.exam, config.exam);

  const caTotal = +(cwScaled + hwScaled + testsScaled + projectScaled).toFixed(2);
  const totalScore = +(caTotal + examScaled).toFixed(2);

  let grade = "F";
  if (totalScore >= 89.5) grade = "A";
  else if (totalScore >= 79.5) grade = "B";
  else if (totalScore >= 59.5) grade = "C";
  else if (totalScore >= 49.5) grade = "D";

  return {
    scaled: {
      cw: cwScaled,
      hw: hwScaled,
      tests: testsScaled,
      project: projectScaled,
      exam: examScaled,
    },
    caTotal,
    totalScore,
    grade,
  };
}

export function toStoredScores(result) {
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
