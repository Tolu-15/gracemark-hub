export function generateAiInsight(report) {
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
    subjects.length >= 4 && percentage >= 70
      ? "Performance shows good consistency across multiple subjects."
      : subjects.length >= 2
        ? "Results show mixed consistency; targeted revision will help stabilise grades."
        : "Limited approved results are available; more published scores will refine this analysis.";

  const suggestion =
    percentage >= 75
      ? "Continue excellent study habits, practice past questions weekly, and mentor peers where possible."
      : percentage >= 50
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
  const score = report.gpa !== undefined && report.gpa !== null ? report.gpa : (report.percentage / 20);
  if (score >= 4.5) return "THIS IS AN OUTSTANDING RESULT. KEEP IT UP!";
  if (score >= 3.5) return "THIS IS A VERY GOOD RESULT. KEEP IT UP!";
  if (score >= 3.0) return "THIS IS A GOOD RESULT. THERE IS STILL ROOM FOR IMPROVEMENT.";
  if (score >= 2.5) return "THIS IS AN AVERAGE RESULT. THERE IS A PRESSING NEED FOR IMPROVEMENT.";
  return "THIS IS A POOR RESULT. THERE IS A PRESSING NEED FOR IMPROVEMENT.";
}

export function getPromotionStatus(report) {
  const { className, percentage, gpa } = report;
  const cName = String(className || "").trim().toUpperCase();
  const isSenior = (cName.includes("SSS") || cName.includes("SS ")) && !cName.includes("JSS");

  if (isSenior) {
    const nextClass = cName.includes("1") ? "SSS 2" : cName.includes("2") ? "SSS 3" : "GRADUATED";
    const currentClass = cName.includes("1") ? "SSS 1" : cName.includes("2") ? "SSS 2" : "SSS 3";
    const g = Number(gpa) || 0;
    if (g >= 2.5) return { status: "PROMOTED", text: `PROMOTED TO ${nextClass}`, code: "success" };
    if (g >= 2.0) return { status: "TRIAL", text: `PROMOTED TO ${nextClass} ON TRIAL`, code: "warning" };
    return { status: "REPEAT", text: `TO REPEAT ${currentClass}`, code: "danger" };
  } else {
    const nextClass = cName.includes("1") ? "JSS 2" : cName.includes("2") ? "JSS 3" : "SSS 1";
    const currentClass = cName.includes("1") ? "JSS 1" : cName.includes("2") ? "JSS 2" : "JSS 3";
    const pct = Number(percentage) || 0;
    if (pct >= 50) return { status: "PROMOTED", text: `PROMOTED TO ${nextClass}`, code: "success" };
    if (pct >= 40) return { status: "TRIAL", text: `PROMOTED TO ${nextClass} ON TRIAL, BUT MUST ATTEND INTERVENTION CLASS.`, code: "warning" };
    return { status: "REPEAT", text: `TO REPEAT ${currentClass}`, code: "danger" };
  }
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
