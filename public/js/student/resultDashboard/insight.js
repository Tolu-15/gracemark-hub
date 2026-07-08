/** Generate academic insight paragraph from report metrics. */
export function generateAiInsight(report) {
  const {
    studentName,
    className,
    termLabel,
    session,
    gpa,
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
  intro += `With an overall average of ${percentage}% and GPA ${gpa.toFixed(2)}, `;
  intro += position && classSize
    ? `they currently rank ${position} out of ${classSize} learners in cumulative performance. `
    : `their cumulative performance reflects steady engagement across approved subjects. `;

  let attendance = "";
  if (attendancePct >= 90) {
    attendance =
      "Attendance is outstanding and supports consistent classroom participation. ";
  } else if (attendancePct >= 75) {
    attendance =
      "Attendance is satisfactory, though maintaining regular presence will strengthen outcomes further. ";
  } else {
    attendance =
      "Attendance needs improvement; more consistent presence is likely to lift scores in upcoming assessments. ";
  }

  let subjectsText = "";
  if (strengths?.length) {
    subjectsText += `Standout strengths appear in ${strengths.join(", ")}. `;
  }
  if (weaknesses?.length) {
    subjectsText += `Additional focus is recommended in ${weaknesses.join(", ")} to balance the overall profile. `;
  }

  const consistency =
    subjects.length >= 4 && gpa >= 3
      ? "Performance shows good consistency across multiple subjects."
      : subjects.length >= 2
        ? "Results show mixed consistency; targeted revision will help stabilise grades."
        : "Limited approved results are available; more published scores will refine this analysis.";

  const suggestion =
    gpa >= 3.5
      ? "Continue excellent study habits, practice past questions weekly, and mentor peers where possible."
      : gpa >= 2.5
        ? "Increase weekly revision time, complete all assignments on schedule, and seek teacher feedback after tests."
        : "Adopt a structured study plan, attend remedial sessions, and prioritise weak topics with daily practice.";

  return `${intro}${attendance}${subjectsText}${consistency} ${suggestion}`;
}

export function gradeToRemark(grade) {
  const g = String(grade || "").toUpperCase();
  if (g === "A") return "EXCELLENT";
  if (g === "B") return "VERY GOOD";
  if (g === "C") return "GOOD";
  if (g === "D") return "FAIR";
  return "NEEDS IMPROVEMENT";
}

export function gradeToGpaPoint(grade) {
  const g = String(grade || "").toUpperCase();
  if (g === "A") return 4;
  if (g === "B") return 3;
  if (g === "C") return 2;
  if (g === "D") return 1;
  return 0;
}

export function buildPrincipalRemark(report) {
  const { percentage, gpa, studentName } = report;
  const name = studentName?.split(" ")[0] || "This student";
  if (gpa >= 3.5) {
    return `${name} has demonstrated exceptional discipline and academic excellence this term. Keep up the commendable effort and leadership in class.`;
  }
  if (gpa >= 2.5) {
    return `${name} has shown satisfactory progress with room for greater consistency. I encourage more focus on weaker subjects next term.`;
  }
  return `${name} is encouraged to improve study habits and class participation. With dedicated effort and parental support, better results are achievable.`;
}

const TRAIT_NAMES = [
  "Punctuality",
  "Neatness",
  "Leadership",
  "Teamwork",
  "Concentration",
  "Handwriting",
  "Interpersonal Skills",
  "Fluency",
  "Initiative",
  "Honesty",
];

export function buildTraits(report) {
  const base = report.attendancePct >= 85 ? 5 : report.attendancePct >= 70 ? 4 : 3;
  const perfBoost = report.gpa >= 3.5 ? 1 : report.gpa >= 2.5 ? 0 : -1;

  return TRAIT_NAMES.map((name, i) => {
    let score = base + (i % 3 === 0 ? perfBoost : 0);
    if (name === "Handwriting" && report.gpa < 2.5) score -= 1;
    if (name === "Leadership" && report.gpa >= 3) score += 1;
    score = Math.max(2, Math.min(5, score));
    return { name, score, max: 5 };
  });
}
