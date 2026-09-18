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
    ? `they currently rank ${position} out of ${classSize} learners in academic performance. `
    : `their academic performance reflects steady engagement across approved subjects. `;

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
    subjectsText += `Notable strengths appear in ${strengths.join(", ")}. `;
  }
  if (weaknesses?.length) {
    subjectsText += `Additional focus is recommended in ${weaknesses.join(", ")} to improve overall academic standing. `;
  }

  const consistency =
    subjects.length >= 4 && percentage >= 70
      ? "Performance shows commendable consistency across multiple subjects."
      : subjects.length >= 2
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

export function gradeToRemark(grade) {
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

export function buildPrincipalRemark(report) {
  const pct = Number(report.percentage ?? report.totalScore ?? 0);
  if (pct >= 80) return "THIS IS AN OUTSTANDING RESULT. KEEP IT UP!";
  if (pct >= 70) return "THIS IS A VERY GOOD RESULT. KEEP IT UP!";
  if (pct >= 60) return "THIS IS A GOOD RESULT. THERE IS STILL ROOM FOR IMPROVEMENT.";
  if (pct >= 50) return "A FAIR RESULT. MORE EFFORT IS REQUIRED FOR BETTER PERFORMANCE.";
  if (pct >= 40) return "THIS IS A WEAK RESULT. THERE IS A PRESSING NEED FOR IMPROVEMENT.";
  return "POOR PERFORMANCE. SERIOUS DEDICATION AND INTERVENTION REQUIRED.";
}

export function getPromotionStatus(report) {
  const { className, percentage } = report;
  const cName = String(className || "").trim().toUpperCase();
  const isSenior = (cName.includes("SSS") || cName.includes("SS ") || cName.includes("SS1") || cName.includes("SS2") || cName.includes("SS3") || cName.includes("SENIOR")) &&
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
    if (pct >= 40) return { status: "TRIAL", text: `PROMOTED TO ${nextClass} ON TRIAL, BUT MUST ATTEND INTERVENTION CLASS.`, code: "warning" };
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

export function buildTraits(report) {
  const pct = Number(report.percentage) || 0;
  const base = report.attendancePct >= 85 ? 5 : report.attendancePct >= 70 ? 4 : 3;
  const perfBoost = pct >= 70 ? 1 : pct >= 50 ? 0 : -1;

  return EXCEL_PERSONAL_SKILLS.map((name, i) => {
    let score = base + (i % 3 === 0 ? perfBoost : 0);
    if (name === "Handwriting" && pct < 50) score -= 1;
    if (name === "Leadership" && pct >= 65) score += 1;
    score = Math.max(2, Math.min(5, score));
    return { name, score, max: 5 };
  });
}

