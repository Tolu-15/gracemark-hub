/**
 * Fuzzy answer matching for CBT exams — a TS port of the scoring rule from the
 * author's separate QuizHub product (client display + server scoring both use
 * this exact function, same as QuizHub's isAnswerCorrect/answer_matches pair).
 *
 * Handles: exact match after whitespace/case normalization, option-letter
 * answers ("A" / "Option B" / "c.") resolved against the question's options,
 * true/false variants (yes/no/1/0/t/f), a numeric answer treated as a 0-based
 * option index, and a prefix-stripped fallback. No partial credit — a question
 * is either fully correct (its points) or 0.
 */

export type CbtQuestionType = "multiple_choice" | "true_false" | "fill_in_the_blank" | "short_answer" | "essay";

/** Essay questions have no single correct answer — a teacher grades them manually. */
export const MANUALLY_GRADED_TYPES: CbtQuestionType[] = ["essay"];

const WHITESPACE_RE = /[\s  -​  　]+/g;
const OPTION_LETTER_RE = /^(?:option\s+)?([a-z])(?:[.:)\s]|$)/i;
const OPTION_PREFIX_RE = /^(?:option\s+)?[a-z][.):\s]+/i;
const BOOL_TRUE_RE = /^(true|t|yes|1)$/i;
const BOOL_FALSE_RE = /^(false|f|no|0)$/i;

function normalize(s: string): string {
  return s.replace(WHITESPACE_RE, " ").trim().toLowerCase();
}

function stripOptionPrefix(s: string): string {
  return s.replace(OPTION_PREFIX_RE, "").trim();
}

/** "A" / "Option B" / "c." -> the option text at that letter's index, or null. */
function resolveOptionLetter(value: string, options: string[]): string | null {
  const m = value.trim().match(OPTION_LETTER_RE);
  if (!m) return null;
  const idx = m[1].toLowerCase().charCodeAt(0) - 97;
  return options[idx] ?? null;
}

export function answerMatches(
  studentAnswer: string | null | undefined,
  correctAnswer: string | null | undefined,
  options: string[] = []
): boolean {
  const student = String(studentAnswer ?? "").trim();
  const correct = String(correctAnswer ?? "").trim();
  if (!student || !correct) return false;

  const ns = normalize(student);
  const nc = normalize(correct);
  if (ns === nc) return true;

  const studentResolved = resolveOptionLetter(student, options);
  if (studentResolved && normalize(studentResolved) === nc) return true;
  const correctResolved = resolveOptionLetter(correct, options);
  if (correctResolved && normalize(correctResolved) === ns) return true;

  const studentIsBool = BOOL_TRUE_RE.test(student) || BOOL_FALSE_RE.test(student);
  const correctIsBool = BOOL_TRUE_RE.test(correct) || BOOL_FALSE_RE.test(correct);
  if (studentIsBool && correctIsBool) return BOOL_TRUE_RE.test(student) === BOOL_TRUE_RE.test(correct);

  if (/^\d+$/.test(student)) {
    const opt = options[Number(student)];
    if (opt !== undefined && normalize(String(opt)) === nc) return true;
  }
  if (/^\d+$/.test(correct)) {
    const opt = options[Number(correct)];
    if (opt !== undefined && normalize(String(opt)) === ns) return true;
  }

  return normalize(stripOptionPrefix(student)) === normalize(stripOptionPrefix(correct));
}

export interface CbtQuestionForScoring {
  id: string;
  question_type: string;
  correct_answer: string | null;
  options: unknown;
  points: number | string;
}

export interface ObjectiveScoreResult {
  autoScore: number;
  maxAutoScore: number;
  maxScore: number;
  hasManualQuestions: boolean;
  /** true = correct, false = incorrect, null = manually graded (essay), not yet scored. */
  perQuestion: Record<string, boolean | null>;
}

/** Scores every auto-gradable question; essay questions are flagged for manual grading instead. */
export function scoreObjectiveAnswers(
  questions: CbtQuestionForScoring[],
  answers: Record<string, string>
): ObjectiveScoreResult {
  let autoScore = 0;
  let maxAutoScore = 0;
  let maxScore = 0;
  let hasManualQuestions = false;
  const perQuestion: Record<string, boolean | null> = {};

  for (const q of questions) {
    const points = Number(q.points) || 1;
    maxScore += points;
    if (MANUALLY_GRADED_TYPES.includes(q.question_type as CbtQuestionType)) {
      hasManualQuestions = true;
      perQuestion[q.id] = null;
      continue;
    }
    maxAutoScore += points;
    const opts = Array.isArray(q.options) ? q.options.map((o) => String(o)) : [];
    const correct = answerMatches(answers[q.id], q.correct_answer, opts);
    perQuestion[q.id] = correct;
    if (correct) autoScore += points;
  }

  return { autoScore, maxAutoScore, maxScore, hasManualQuestions, perQuestion };
}
