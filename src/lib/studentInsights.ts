import { getGradeAndRemark } from "./gradingEngine";
import type { Milestone, StudentReport, SubjectLine } from "./reportBuilder";

/**
 * Turns one published report into a plain-language summary: where the marks were lost, what is relatively
 * strong, where the student stands in the class, attendance and personal skills, and what to do next.
 *
 * It is a rules-based writer, not a chatbot: every sentence is built from this student's own numbers, so it
 * is specific, repeatable and can be tested. It only ever reads a report the student is already allowed to
 * see, so a Terminal Result summary appears only once the card view has been used.
 *
 * Tone rule: it states facts. It never praises a result that failed, and it never uses a generic line that
 * could be pasted onto another student's card.
 */

export type Tone = "good" | "neutral" | "warn" | "bad";
export interface InsightSection {
  id: string;
  title: string;
  tone: Tone;
  items: string[];
}
export interface Insights {
  headline: { tone: Tone; text: string };
  sections: InsightSection[];
}

const ORDER: Milestone[] = ["PR1", "PR2", "PR3", "TR"];
const round1 = (n: number) => Math.round(n * 10) / 10;
export const ordinal = (n: number) => {
  const v = n % 100;
  const s = ["th", "st", "nd", "rd"];
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The mark used to compare a subject with the class (the same unit as line.classAverage). */
export const scoreOf = (line: SubjectLine, milestone: Milestone) => (milestone === "TR" ? line.annualAverage ?? line.total : line.percentage ?? 0);

/** Classwork, homework, tests and project as a percentage: comparable between progress reports and the terminal result. */
export const caPercent = (line: SubjectLine, milestone: Milestone) =>
  milestone === "TR" ? ((line.cw + line.hw + line.test + (line.project ?? 0)) / 30) * 100 : line.percentage ?? 0;

const gradeOf = (score: number, senior: boolean) => getGradeAndRemark(score, senior).grade;
const PASS_MARK = (senior: boolean) => (senior ? 40 : 49.5);

/** Which part of the marks is furthest below its maximum, with the numbers. */
function weakestComponent(line: SubjectLine, milestone: Milestone): string | null {
  const testMax = milestone === "PR3" || milestone === "TR" ? 10 : 15;
  const parts: { name: string; got: number; max: number }[] = [
    { name: "classwork", got: line.cw, max: 10 },
    { name: "homework", got: line.hw, max: 5 },
    { name: "tests", got: line.test, max: testMax },
  ];
  if (line.project !== null && (milestone === "PR3" || milestone === "TR")) parts.push({ name: "project", got: line.project, max: 5 });
  const worst = parts.map((p) => ({ ...p, ratio: p.got / p.max })).sort((a, b) => a.ratio - b.ratio)[0];
  return worst && worst.ratio < 0.6 ? `${worst.name} (${round1(worst.got)}/${worst.max})` : null;
}

export const SKILL_ADVICE: Record<string, string> = {
  punctuality: "Be at school before assembly every day. Prepare the bag and uniform the night before and sleep early.",
  concentration: "Sit near the front, keep the desk clear, and write questions down to ask the teacher instead of talking. Study in 25-minute blocks with no phone.",
  contribution: "Set a target of answering or asking at least one question in every lesson.",
  organisation: "Keep one notebook per subject, write homework in a diary daily, and pack the next day's books each evening.",
  handwriting: "Practise ten neat lines every day. Slow down and form letters fully, because unclear writing costs marks in exams.",
  fluency: "Read aloud for 15 minutes daily and answer in full sentences in class.",
  sports: "Take part in games and PE every week. Regular activity builds fitness and helps focus in class.",
  neatness: "Check uniform, books and desk every morning, and present written work neatly.",
  teamwork: "Take an active part in group tasks and listen to others before answering.",
  leadership: "Volunteer for a small responsibility, such as leading a group task or helping with class duties.",
  interpersonal: "Practise courteous communication and speak to a teacher early if a problem with a classmate starts.",
  initiative: "Start tasks without being reminded and do one extra practice question per subject after homework.",
};

/** The psychomotor domain: practical and physical skills. Everything else on the card is the affective domain (attitude and behaviour). */
const PSYCHOMOTOR = new Set(["handwriting", "fluency", "sports", "neatness"]);

export function buildInsights(report: StudentReport, previous?: StudentReport | null): Insights {
  const m = report.milestone;
  const senior = report.isSenior;
  const isTR = m === "TR";
  const when = isTR ? "next term" : "before the next report";
  const subjects = report.subjects.filter((s) => Number.isFinite(scoreOf(s, m)));
  const sections: InsightSection[] = [];

  const scored = subjects.map((s) => {
    const score = round1(scoreOf(s, m));
    return { line: s, score, grade: gradeOf(score, senior), avg: s.classAverage, gap: s.classAverage == null ? null : round1(score - s.classAverage) };
  });
  const failing = scored.filter((s) => s.grade === "F");
  const weak = scored.filter((s) => s.grade === "F" || s.grade === "D");
  const strong = scored.filter((s) => s.grade === "A" || s.grade === "B");

  /* ------------------------------ Overall ------------------------------ */
  const pct = round1(report.summary.percentage);
  const pass = PASS_MARK(senior);
  const overallFail = report.summary.grade === "F";
  let headline: Insights["headline"];
  if (overallFail) {
    headline = {
      tone: "bad",
      text: `Overall ${pct}% (grade F), below the pass mark of ${pass}%. ${failing.length} of ${scored.length} subjects are failing${failing.length ? `: ${list(failing.map((f) => f.line.name))}` : ""}.`,
    };
  } else if (failing.length > 0) {
    headline = { tone: "warn", text: `Overall ${pct}% (grade ${report.summary.grade}), but ${list(failing.map((f) => f.line.name))} ${failing.length === 1 ? "is" : "are"} below the pass mark.` };
  } else if (report.summary.grade === "A" || report.summary.grade === "B") {
    headline = { tone: "good", text: `Overall ${pct}% (grade ${report.summary.grade}) with no failing subject.` };
  } else {
    headline = { tone: "neutral", text: `Overall ${pct}% (grade ${report.summary.grade}) with no failing subject.${weak.length ? ` ${list(weak.map((w) => w.line.name))} ${weak.length === 1 ? "is" : "are"} at grade D.` : ""}` };
  }

  const overall: string[] = [];
  if (report.summary.position != null && report.summary.rankedCount) {
    const p = report.summary.position;
    const n = report.summary.rankedCount;
    const share = p / n;
    const band = share <= 0.1 ? "in the top 10%" : share <= 1 / 3 ? "in the top third" : share <= 2 / 3 ? "in the middle third" : "in the bottom third";
    overall.push(`Position: ${ordinal(p)} out of ${n}, ${band}${n !== report.classSize ? " (ranked across every class in your level)" : ""}${senior ? ", ranked by GPA" : ""}.`);
  } else if (!isTR) {
    overall.push("Class position is shown only on the terminal result.");
  }
  if (overallFail) overall.push(`To reach the pass mark you need ${round1(pass - pct)} more points on your overall average, so the weak subjects below matter most.`);
  if (report.summary.gpa != null) overall.push(`GPA: ${report.summary.gpa.toFixed(2)} out of 5.00.`);
  sections.push({ id: "overall", title: "Overall", tone: headline.tone, items: overall });

  /* ---------------------------- Weak areas ----------------------------- */
  const behind = scored.filter((s) => s.grade !== "F" && s.grade !== "D" && s.gap != null && s.gap <= -10);
  const weakList = [...weak, ...behind].sort((a, b) => a.score - b.score).slice(0, 5);
  const weakItems = weakList.map((s) => {
    const bits = [`${s.line.name}: ${s.score}% (grade ${s.grade})`];
    if (s.gap != null && s.avg != null) bits.push(s.gap < 0 ? `${Math.abs(s.gap)} points below the class average of ${round1(s.avg)}` : `${s.gap} points above the class average of ${round1(s.avg)}`);
    if (s.line.lowest != null && s.score <= s.line.lowest) bits.push("the lowest score in the class");
    let cause = "";
    if (isTR && s.line.exam != null) {
      const ca = round1(caPercent(s.line, m));
      const exam = round1((s.line.exam / 70) * 100);
      if (exam <= ca - 15) cause = ` Exam ${round1(s.line.exam)}/70 (${exam}%) is far below classwork and tests (${ca}%): the work is understood during the term but marks are lost in the exam.`;
      else if (ca < 50 && exam < 50) cause = ` Both classwork and tests (${ca}%) and the exam (${exam}%) are weak, so the basics of this subject need re-teaching.`;
      else if (ca < 50) cause = ` Classwork, homework, tests and project add up to only ${round1(((s.line.cw + s.line.hw + s.line.test + (s.line.project ?? 0)) / 30) * 30)}/30; marks are being lost before the exam.`;
    } else {
      const c = weakestComponent(s.line, m);
      if (c) cause = ` The weakest part is ${c}.`;
    }
    return `${bits.join("; ")}.${cause}`;
  });
  if (weakItems.length) sections.push({ id: "weak", title: "Weak areas", tone: weak.length ? "bad" : "warn", items: weakItems });

  /* --------------------------- Strong areas ---------------------------- */
  const strongItems = [...strong]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => `${s.line.name}: ${s.score}% (grade ${s.grade})${s.gap != null && s.avg != null ? `, ${s.gap >= 0 ? `${s.gap} points above` : `${Math.abs(s.gap)} points below`} the class average of ${round1(s.avg)}` : ""}.`);
  if (strongItems.length) sections.push({ id: "strong", title: overallFail ? "Relatively stronger subjects" : "Strong areas", tone: overallFail ? "neutral" : "good", items: strongItems });

  /* ------------------------ Compared with the class -------------------- */
  const withAvg = scored.filter((s) => s.gap != null);
  if (withAvg.length >= 3) {
    const above = withAvg.filter((s) => (s.gap as number) > 0).length;
    const below = withAvg.filter((s) => (s.gap as number) < 0).length;
    const items = [`Above the class average in ${above} of ${withAvg.length} subjects and below it in ${below}.`];
    withAvg
      .filter((s) => s.line.highest != null && s.score < (s.line.highest as number) - 15)
      .sort((a, b) => (b.line.highest as number) - b.score - ((a.line.highest as number) - a.score))
      .slice(0, 2)
      .forEach((s) => items.push(`${s.line.name}: the top score in the class is ${round1(s.line.highest as number)}, ${round1((s.line.highest as number) - s.score)} points above yours.`));
    sections.push({ id: "class", title: "Compared with the class", tone: below > above ? "warn" : "neutral", items });
  }

  /* --------------------------- How the marks came ---------------------- */
  if (isTR) {
    const withExam = subjects.filter((s) => s.exam != null);
    if (withExam.length >= 3) {
      const caAvg = round1(withExam.reduce((a, s) => a + caPercent(s, m), 0) / withExam.length);
      const examAvg = round1(withExam.reduce((a, s) => a + ((s.exam as number) / 70) * 100, 0) / withExam.length);
      const gap = round1(caAvg - examAvg);
      const items = [`Classwork, homework, tests and project average ${caAvg}%; the exam averages ${examAvg}%.`];
      if (gap >= 12) items.push(`Exam marks are ${gap} points lower than coursework across subjects. Practise timed past questions and revise from your notes weekly, not only before the exam.`);
      else if (gap <= -12) items.push(`The exam average is ${Math.abs(gap)} points higher than coursework. Marks are being lost in classwork, homework and tests: submit every piece of work on time.`);
      sections.push({ id: "marks", title: "How the marks were earned", tone: gap >= 12 || caAvg < 50 ? "warn" : "neutral", items });
    }
  }

  /* ------------------------ Since the last report ---------------------- */
  if (previous && ORDER.indexOf(previous.milestone) < ORDER.indexOf(m)) {
    const prevByName = new Map(previous.subjects.map((s) => [s.subjectId, s]));
    const moves = subjects
      .map((s) => {
        const p = prevByName.get(s.subjectId);
        return p ? { name: s.name, from: round1(caPercent(p, previous.milestone)), to: round1(caPercent(s, m)) } : null;
      })
      .filter((x): x is { name: string; from: number; to: number } => x !== null)
      .map((x) => ({ ...x, diff: round1(x.to - x.from) }));
    if (moves.length >= 2) {
      const avgFrom = round1(moves.reduce((a, x) => a + x.from, 0) / moves.length);
      const avgTo = round1(moves.reduce((a, x) => a + x.to, 0) / moves.length);
      const items = [`Classwork-and-test average moved from ${avgFrom}% (${previous.milestone}) to ${avgTo}% (${m}).`];
      const drops = moves.filter((x) => x.diff <= -8).sort((a, b) => a.diff - b.diff).slice(0, 2);
      const rises = moves.filter((x) => x.diff >= 8).sort((a, b) => b.diff - a.diff).slice(0, 2);
      drops.forEach((x) => items.push(`${x.name} fell from ${x.from}% to ${x.to}% (${Math.abs(x.diff)} points down).`));
      rises.forEach((x) => items.push(`${x.name} rose from ${x.from}% to ${x.to}% (${x.diff} points up).`));
      sections.push({ id: "trend", title: `Since ${previous.milestone}`, tone: avgTo < avgFrom - 3 ? "warn" : "neutral", items });
    }
  }

  /* ----------------------------- Attendance ---------------------------- */
  let attendancePct: number | null = null;
  if (report.attendance && report.attendance.opened > 0) {
    const { opened, present, absent } = report.attendance;
    attendancePct = round1((present / opened) * 100);
    const items = [`Present ${present} of ${opened} school days (${attendancePct}%); absent ${absent} day${absent === 1 ? "" : "s"}.`];
    let tone: Tone = "neutral";
    if (attendancePct < 80) {
      tone = "bad";
      items.push(`Missing ${absent} days is a serious problem: roughly one day in every ${Math.max(2, Math.round(opened / Math.max(absent, 1)))} was lost.${weak.length ? ` It is likely contributing to the weak results in ${list(weak.slice(0, 3).map((w) => w.line.name))}.` : ""}`);
    } else if (attendancePct < 90) {
      tone = "warn";
      items.push(`${absent} missed days is too many; aim for at most ${Math.max(1, Math.round(opened * 0.05))} next term.`);
    } else if (attendancePct >= 95) tone = "good";
    sections.push({ id: "attendance", title: "Attendance", tone, items });
  }

  /* --------------------- Personal skills (psychomotor) ------------------ */
  const scoredSkills = (report.skills || []).filter((k) => k.score != null) as { key: string; label: string; score: number }[];
  const lowSkills = [...scoredSkills].filter((k) => k.score <= 3).sort((a, b) => a.score - b.score);
  if (scoredSkills.length >= 6) {
    const avg = round1(scoredSkills.reduce((a, k) => a + k.score, 0) / scoredSkills.length);
    const psychomotor = scoredSkills.filter((k) => PSYCHOMOTOR.has(k.key));
    const affective = scoredSkills.filter((k) => !PSYCHOMOTOR.has(k.key));
    const mean = (xs: typeof scoredSkills) => (xs.length ? round1(xs.reduce((a, k) => a + k.score, 0) / xs.length) : null);
    const items = [`Personal skills average ${avg}/5 (total ${report.skillsTotal ?? scoredSkills.reduce((a, k) => a + k.score, 0)}/60).`];
    const aAvg = mean(affective);
    const pAvg = mean(psychomotor);
    if (aAvg != null && pAvg != null) {
      items.push(
        `Affective domain (attitude and behaviour: punctuality, concentration, contribution, organisation, teamwork, leadership, interpersonal skills, initiative) averages ${aAvg}/5. ` +
          `Psychomotor domain (handwriting, fluency, sports, neatness) averages ${pAvg}/5.`
      );
      if (Math.abs(aAvg - pAvg) >= 0.5) items.push(`The ${aAvg < pAvg ? "affective" : "psychomotor"} domain is the weaker one by ${round1(Math.abs(aAvg - pAvg))} points and needs the most attention.`);
    }
    const top = scoredSkills.filter((k) => k.score >= 4 && k.score === Math.max(...scoredSkills.map((x) => x.score)));
    if (top.length && avg >= 3) items.push(`Highest: ${list(top.slice(0, 4).map((k) => `${k.label} (${k.score})`))}.`);
    if (lowSkills.length) items.push(`Lowest: ${list(lowSkills.slice(0, 4).map((k) => `${k.label} (${k.score})`))}.`);
    lowSkills.slice(0, 3).forEach((k) => SKILL_ADVICE[k.key] && items.push(`${k.label}: ${SKILL_ADVICE[k.key]}`));
    const byKey = new Map(scoredSkills.map((k) => [k.key, k.score]));
    if ((byKey.get("concentration") ?? 5) <= 3 && weak.length) items.push(`Low concentration (${byKey.get("concentration")}/5) fits the weak results in ${list(weak.slice(0, 3).map((w) => w.line.name))}; fixing it is likely to help the marks.`);
    if ((byKey.get("punctuality") ?? 5) <= 2 && attendancePct != null && attendancePct < 90) items.push(`Punctuality (${byKey.get("punctuality")}/5) and attendance (${attendancePct}%) point to the same problem: time in class is being lost.`);
    sections.push({ id: "skills", title: "Personal skills", tone: avg >= 4 ? "good" : avg >= 3 ? "neutral" : "warn", items });
  }

  /* ----------------------------- Next steps ---------------------------- */
  const actions: string[] = [];
  const worst = weakList.slice(0, 2);
  worst.forEach((s) => {
    const c = isTR ? null : weakestComponent(s.line, m);
    const how =
      isTR && s.line.exam != null && (s.line.exam / 70) * 100 <= caPercent(s.line, m) - 15
        ? "practise timed past questions and revise it weekly"
        : c
          ? `start with ${c}: attend, complete and hand in every task`
          : "ask the teacher for the topics you missed and practise one set of questions every day";
    actions.push(`${s.line.name} (${s.score}%${s.gap != null && s.gap < 0 ? `, ${Math.abs(s.gap)} below the class average` : ""}): ${how}, aiming to reach ${Math.max(Math.ceil(pass) + 5, Math.ceil(s.score) + 10)}% ${when}.`);
  });
  if (attendancePct != null && attendancePct < 90) actions.push(`Attend every day: ${report.attendance!.absent} missed days cost lessons in every subject. Aim for 95% or more ${when}.`);
  if (lowSkills[0] && SKILL_ADVICE[lowSkills[0].key]) actions.push(`${lowSkills[0].label} (${lowSkills[0].score}/5): ${SKILL_ADVICE[lowSkills[0].key]}`);
  if (report.summary.position != null && report.summary.rankedCount && report.summary.position / report.summary.rankedCount > 0.1) {
    const gaps = scored.filter((s) => s.gap != null && (s.gap as number) < 0).sort((a, b) => (a.gap as number) - (b.gap as number)).slice(0, 2);
    if (gaps.length) actions.push(`To move up from ${ordinal(report.summary.position)} place, close the gap where you are furthest behind the class average: ${list(gaps.map((g) => `${g.line.name} (${g.gap})`))}.`);
  }
  if (!actions.length) actions.push(overallFail ? "Meet your class teacher to plan how to recover the failing subjects." : `Keep every subject at its current level ${when}; no subject needs urgent action.`);
  sections.push({ id: "next", title: "What to do next", tone: overallFail || weak.length ? "warn" : "neutral", items: actions.slice(0, 5) });

  return { headline, sections };
}

/* --------------------------- Progress chart data --------------------------- */

export interface ProgressPoint {
  milestone: Milestone;
  label: string;
  /** Average classwork-and-test percentage: comparable across all four reports. */
  coursework: number;
  /** Terminal result only: the overall percentage including the exam. */
  overall: number | null;
}

export function progressSeries(reports: Partial<Record<Milestone, StudentReport | null>>): ProgressPoint[] {
  const out: ProgressPoint[] = [];
  for (const milestone of ORDER) {
    const r = reports[milestone];
    if (!r || !r.subjects.length) continue;
    const coursework = round1(r.subjects.reduce((a, s) => a + caPercent(s, milestone), 0) / r.subjects.length);
    out.push({ milestone, label: milestone === "TR" ? "Terminal" : milestone.replace("PR", "PR "), coursework, overall: milestone === "TR" ? round1(r.summary.percentage) : null });
  }
  return out;
}
