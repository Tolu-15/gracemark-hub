/**
 * Gracemark Academy — Grading Engine
 * Mirrors the school's Excel result sheets (MARK SHEET + COLLATION SHEET).
 *
 * Raw entries (per student, per subject, per term):
 * - Classwork: weeks 1–10, each /10
 * - Homework:  weeks 1–10, each /10
 * - Tests: Test 1 /15, Test 2 /15, Test 3 /30
 * - Project /5, Exam /70
 *
 * Classwork / homework are given weekly (weeks 1–10) or fortnightly (weeks
 * 2, 4, 6, 8, 10), set per subject on the class subject list. The divisor is
 * the number of scheduled weeks in the window (the Excel "AV RATE"), and a
 * blank score in a scheduled week counts as 0.
 *
 * Progress reports (each /30, percentage = CA × 10/3):
 * - PR1 (weeks 1–4):  CW /10 + HW /5 + Test 1 (/15)
 * - PR2 (weeks 1–6):  CW /10 + HW /5 + (T1 + T2) ÷ 2 (/15)
 * - PR3 (weeks 1–10): CW /10 + HW /5 + (T1 + T2 + T3) ÷ 6 (/10) + Project /5
 *
 * Terminal result (/100):
 * - CW = average of PR1–PR3 CW, HW = average of PR1–PR3 HW,
 *   Test = (PR1 + PR2 + PR3 test) ÷ 4 (/10), + Project /5 + Exam /70
 */

export interface RawScores {
  cw: (number | string)[];
  hw: (number | string)[];
  tests: (number | string)[];
  project: number | string;
  exam: number | string;
}

/** Weeks (1-based) in which the class is given classwork / homework. */
export interface AssessmentWeeks {
  cw: number[];
  hw: number[];
}

export type AssessmentFrequency = "weekly" | "fortnightly";

/** Scheduled weeks for a subject: weekly = 1–10, fortnightly = 2, 4, 6, 8, 10. */
export function weeksForFrequency(frequency: AssessmentFrequency | string | null | undefined): AssessmentWeeks {
  const weeks = frequency === "weekly" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [2, 4, 6, 8, 10];
  return { cw: weeks, hw: weeks };
}

/**
 * Scheduled weeks (up to `lastWeek`) where no student in the class has a score.
 * These count as 0 for everyone, so they are usually a forgotten entry.
 */
export function emptyScheduledWeeks(rows: RawScores[], weeks: AssessmentWeeks, lastWeek = 10) {
  const filled = detectAssessmentWeeks(rows);
  return {
    cw: weeks.cw.filter((w) => w <= lastWeek && !filled.cw.includes(w)),
    hw: weeks.hw.filter((w) => w <= lastWeek && !filled.hw.includes(w)),
  };
}

export interface PRResult {
  interval: "pr1" | "pr2" | "pr3";
  label: string;
  cw: number;
  hw: number;
  test: number;
  project: number | null;
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

/** Last week counted by each progress report (Excel formulas). */
export const PR_WINDOWS = { pr1: 4, pr2: 6, pr3: 10 } as const;

export interface GradeBand {
  min: number;
  grade: string;
  remark: string;
}

/** SSS grading system (SSS Excel MARK SHEET, AG2:AI7). */
export const SENIOR_GRADE_BANDS: GradeBand[] = [
  { min: 75, grade: "A", remark: "EXCELLENT" },
  { min: 70, grade: "B", remark: "VERY GOOD" },
  { min: 50, grade: "C", remark: "CREDIT" },
  { min: 40, grade: "D", remark: "PASS" },
  { min: 0, grade: "F", remark: "FAIL" },
];

/** JSS grading system (JSS Excel MARK SHEET, AG2:AI7). */
export const JUNIOR_GRADE_BANDS: GradeBand[] = [
  { min: 89.5, grade: "A", remark: "EXCELLENT" },
  { min: 79.5, grade: "B", remark: "GOOD" },
  { min: 59.5, grade: "C", remark: "SATISFACTORY" },
  { min: 49.5, grade: "D", remark: "WEAK" },
  { min: 0, grade: "F", remark: "FAIL" },
];

export function isFilled(val: unknown): boolean {
  return val !== null && val !== undefined && String(val).trim() !== "";
}

export function toNumber(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : NaN;
}

function num(val: unknown): number {
  if (!isFilled(val)) return 0;
  const n = toNumber(val);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  return emptyRawScores();
}

export function validateRawScores(rawScores: Partial<RawScores> = {}) {
  const issues: { field: string; index: number; value: any; max: number }[] = [];

  const checkList = (values: any[] | undefined, field: string, maxFor: (i: number) => number) => {
    (values || []).forEach((val, index) => {
      if (!isFilled(val)) return;
      const n = toNumber(val);
      const max = maxFor(index);
      if (!Number.isFinite(n) || n < 0 || n > max) issues.push({ field, index, value: val, max });
    });
  };

  checkList(rawScores.cw, "cw", () => GRADING_CONFIG.cw.itemMax);
  checkList(rawScores.hw, "hw", () => GRADING_CONFIG.hw.itemMax);
  checkList(rawScores.tests, "tests", (i) => GRADING_CONFIG.tests.maxes[i] ?? 15);
  checkList([rawScores.project], "project", () => GRADING_CONFIG.project.max);
  checkList([rawScores.exam], "exam", () => GRADING_CONFIG.exam.max);

  return { valid: issues.length === 0, issues };
}

export function isSeniorClass(className?: string): boolean {
  const c = String(className || "").trim().toUpperCase();
  return (
    (c.includes("SSS") || c.includes("SS ") || /\bSS[123]\b/.test(c) || c.includes("SENIOR")) &&
    !c.includes("JSS") &&
    !c.includes("JUNIOR")
  );
}

export function getGradeAndRemark(score: number | string, isSenior = false): { grade: string; remark: string } {
  const s = Number(score) || 0;
  const bands = isSenior ? SENIOR_GRADE_BANDS : JUNIOR_GRADE_BANDS;
  const band = bands.find((b) => s >= b.min) || bands[bands.length - 1];
  return { grade: band.grade, remark: band.remark };
}

/** Weeks (1-based) where at least one student in the class has an entry. */
export function detectAssessmentWeeks(rows: RawScores[]): AssessmentWeeks {
  const cw = new Set<number>();
  const hw = new Set<number>();
  rows.forEach((raw) => {
    (raw.cw || []).forEach((v, i) => isFilled(v) && cw.add(i + 1));
    (raw.hw || []).forEach((v, i) => isFilled(v) && hw.add(i + 1));
  });
  return {
    cw: Array.from(cw).sort((a, b) => a - b),
    hw: Array.from(hw).sort((a, b) => a - b),
  };
}

/** Classwork or homework score for the window, using the class's given weeks. */
function windowScore(values: (number | string)[], lastWeek: number, givenWeeks: number[] | undefined, weight: number) {
  const weeks = givenWeeks
    ? givenWeeks.filter((w) => w <= lastWeek)
    : values.slice(0, lastWeek).map((v, i) => (isFilled(v) ? i + 1 : 0)).filter(Boolean);
  if (!weeks.length) return { score: 0, given: 0, entered: 0 };
  const sum = weeks.reduce((s, w) => s + num(values[w - 1]), 0);
  const entered = weeks.filter((w) => isFilled(values[w - 1])).length;
  // Each entry is /10; the average is scaled to the component weight (/10 or /5).
  const score = (sum / weeks.length) * (weight / GRADING_CONFIG.cw.itemMax);
  return { score, given: weeks.length, entered };
}

function buildPR(
  interval: "pr1" | "pr2" | "pr3",
  raw: RawScores,
  isSenior: boolean,
  weeks?: AssessmentWeeks
): PRResult {
  const lastWeek = PR_WINDOWS[interval];
  const cw = windowScore(raw.cw || [], lastWeek, weeks?.cw, GRADING_CONFIG.cw.weight);
  const hw = windowScore(raw.hw || [], lastWeek, weeks?.hw, GRADING_CONFIG.hw.weight);
  const t = raw.tests || [];

  let test: number;
  let project: number | null = null;
  let testEntered: boolean;
  if (interval === "pr1") {
    test = num(t[0]);
    testEntered = isFilled(t[0]);
  } else if (interval === "pr2") {
    test = (num(t[0]) + num(t[1])) / 2;
    testEntered = isFilled(t[0]) || isFilled(t[1]);
  } else {
    test = (num(t[0]) + num(t[1]) + num(t[2])) / 6;
    project = num(raw.project);
    testEntered = isFilled(t[0]) || isFilled(t[1]) || isFilled(t[2]) || isFilled(raw.project);
  }

  const totalCA = cw.score + hw.score + test + (project ?? 0);
  const percentage = (totalCA * 10) / 3;
  const { grade, remark } = getGradeAndRemark(percentage, isSenior);

  return {
    interval,
    label: interval === "pr1" ? "Weeks 1 – 4" : interval === "pr2" ? "Weeks 1 – 6" : "Weeks 1 – 10",
    cw: round2(cw.score),
    hw: round2(hw.score),
    test: round2(test),
    project: project === null ? null : round2(project),
    totalCA: round2(totalCA),
    percentage: round2(percentage),
    grade,
    remark,
    hasData: cw.entered > 0 || hw.entered > 0 || testEntered,
  };
}

export function calculatePR1(raw: RawScores, isSenior = false, weeks?: AssessmentWeeks): PRResult {
  return buildPR("pr1", raw, isSenior, weeks);
}

export function calculatePR2(raw: RawScores, isSenior = false, weeks?: AssessmentWeeks): PRResult {
  return buildPR("pr2", raw, isSenior, weeks);
}

export function calculatePR3(raw: RawScores, isSenior = false, weeks?: AssessmentWeeks): PRResult {
  return buildPR("pr3", raw, isSenior, weeks);
}

export function calculateTR(
  raw: RawScores,
  options: { isSenior?: boolean; className?: string; weeks?: AssessmentWeeks } = {}
): TRResult {
  const isSenior = options.isSenior ?? (options.className ? isSeniorClass(options.className) : false);
  const pr1 = buildPR("pr1", raw, isSenior, options.weeks);
  const pr2 = buildPR("pr2", raw, isSenior, options.weeks);
  const pr3 = buildPR("pr3", raw, isSenior, options.weeks);

  const cw = (pr1.cw + pr2.cw + pr3.cw) / 3;
  const hw = (pr1.hw + pr2.hw + pr3.hw) / 3;
  const tests = (pr1.test + pr2.test + pr3.test) / 4;
  const project = Math.min(Math.max(0, num(raw.project)), GRADING_CONFIG.project.max);
  const exam = Math.min(Math.max(0, num(raw.exam)), GRADING_CONFIG.exam.max);

  const caTotal = cw + hw + tests + project;
  const totalScore = caTotal + exam;
  const { grade, remark } = getGradeAndRemark(totalScore, isSenior);

  return {
    scaled: { cw: round2(cw), hw: round2(hw), tests: round2(tests), project: round2(project), exam: round2(exam) },
    caTotal: round2(caTotal),
    totalScore: round2(totalScore),
    grade,
    remark,
    hasData: pr3.hasData || pr2.hasData || pr1.hasData || isFilled(raw.exam),
  };
}

export function calculateStudentResult(raw: RawScores, _config = GRADING_CONFIG, options: { isSenior?: boolean; className?: string; weeks?: AssessmentWeeks } = {}) {
  return calculateTR(raw, options);
}

/** Values written to the results row. Components keep 2 decimals so the total adds up. */
export function toStoredScores(result: TRResult, rawScores?: RawScores) {
  return {
    cw: result.scaled.cw,
    hw: result.scaled.hw,
    test: result.scaled.tests,
    project: result.scaled.project,
    exam: result.scaled.exam,
    total: result.totalScore,
    grade: result.grade,
    ...(rawScores ? { score_breakdown: rawScores } : {}),
  };
}

// --------------------------------------------------------------------
// Overall results (GPA, position, principal's remark)
// --------------------------------------------------------------------

/**
 * Fair GPA (out of 5): Σ(total × credit unit) ÷ (student's own units × 20).
 * Scores are /100 and GPA is /5, and 100 ÷ 5 = 20.
 */
export function calculateGPA(rows: { total: number; creditUnit: number }[]): number | null {
  const units = rows.reduce((s, r) => s + (r.creditUnit > 0 ? r.creditUnit : 0), 0);
  if (units <= 0) return null;
  const weighted = rows.reduce((s, r) => s + (r.creditUnit > 0 ? r.total * r.creditUnit : 0), 0);
  return round2(weighted / (units * 20));
}

/** Competition ranking ("1, 2, 2, 4"). Returns a map of id → position. */
export function rankPositions(entries: { id: string; value: number | null }[]): Map<string, number> {
  const ranked = entries.filter((e) => e.value !== null) as { id: string; value: number }[];
  const map = new Map<string, number>();
  ranked.forEach((e) => {
    map.set(e.id, 1 + ranked.filter((o) => o.value > e.value).length);
  });
  return map;
}

/** Principal's remark: SSS uses GPA bands, JSS uses percentage bands (Excel TR sheets). */
export function principalRemark(isSenior: boolean, percentage: number, gpa: number | null): string {
  if (isSenior) {
    const g = gpa ?? 0;
    if (g >= 4.5) return "THIS IS AN OUTSTANDING RESULT. KEEP IT UP!";
    if (g >= 3.5) return "THIS IS A VERY GOOD RESULT. KEEP IT UP!";
    if (g >= 3) return "THIS IS A GOOD RESULT. THERE IS STILL ROOM FOR IMPROVEMENT.";
    if (g >= 2.5) return "THIS IS AN AVERAGE RESULT. THERE IS A PRESSING NEED FOR IMPROVEMENT.";
    return "THIS IS A POOR RESULT. THERE IS A PRESSING NEED FOR IMPROVEMENT.";
  }
  const p = percentage;
  if (p >= 89.5) return "THIS IS AN EXCELLENT RESULT. KEEP IT UP!";
  if (p >= 79.5) return "THIS IS A GOOD RESULT. HOWEVER, THERE IS ROOM FOR IMPROVEMENT.";
  if (p >= 59.5) return "THIS IS A SATISFACTORY RESULT. THERE IS A NEED FOR IMPROVEMENT.";
  if (p >= 49.5) return "THIS IS A WEAK RESULT. THERE IS A NEED FOR IMPROVEMENT.";
  return "THIS IS A POOR RESULT. THERE IS A PRESSING NEED FOR IMPROVEMENT.";
}

/** The 12 personal skills on the Excel terminal report. */
export const PERSONAL_SKILLS = [
  { key: "punctuality", label: "Punctuality" },
  { key: "concentration", label: "Concentration in Class" },
  { key: "contribution", label: "Contribution in Class" },
  { key: "organisation", label: "Organisational Skill" },
  { key: "handwriting", label: "Handwriting" },
  { key: "fluency", label: "Fluency" },
  { key: "sports", label: "Games/Sports" },
  { key: "neatness", label: "Neatness" },
  { key: "teamwork", label: "Teamwork" },
  { key: "leadership", label: "Leadership" },
  { key: "interpersonal", label: "Interpersonal Skills" },
  { key: "initiative", label: "Initiative" },
] as const;
