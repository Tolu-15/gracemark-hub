import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInsights, caPercent, ordinal, progressSeries, scoreOf } from "./studentInsights";

const PRAISE = /well done|excellent|great|congratulat|keep it up|keep up|proud|impressive|outstanding|brilliant|fantastic/i;

/** Builds a Terminal Result subject line. Marks: classwork /10, homework /5, tests /10, project /5, exam /70. */
const trLine = (name: string, cw: number, hw: number, test: number, project: number, exam: number, avg: number, lowest = 20, highest = 90): any => {
  const total = cw + hw + test + project + exam;
  return { subjectId: name, name, creditUnit: 1, cw, hw, test, project, exam, total, percentage: null, grade: "", remark: "", classAverage: avg, lowest, highest, term1: null, term2: null, annualAverage: null };
};
const prLine = (name: string, cw: number, hw: number, test: number, pct: number, avg: number): any => ({
  subjectId: name, name, creditUnit: 1, cw, hw, test, project: null, exam: null, total: (pct * 3) / 10, percentage: pct, grade: "", remark: "", classAverage: avg, lowest: null, highest: null, term1: null, term2: null, annualAverage: null,
});

const skills = (scores: Record<string, number>) =>
  Object.entries(scores).map(([key, score]) => ({ key, label: key[0].toUpperCase() + key.slice(1), score }));

const allText = (r: ReturnType<typeof buildInsights>) => [r.headline.text, ...r.sections.flatMap((s) => [s.title, ...s.items])].join("\n");

function report(over: Record<string, any> = {}): any {
  return {
    version: 1, milestone: "TR", milestoneLabel: "Terminal Result", term: "term1", termLabel: "First Term", session: "2026/2027",
    classId: "c", className: "JSS 1", isSenior: false, classSize: 22, student: { id: "s", name: "Test Student", admissionNo: "GMA1" },
    subjects: [], summary: { total: 0, percentage: 0, grade: "F", remark: "FAIL", gpa: null, position: null, rankedCount: null, principalRemark: null },
    attendance: null, skills: null, skillsTotal: null, teacherRemark: null, nextTermBegins: null, principalSignature: null, promotion: null, generatedAt: "", ...over,
  };
}

const failing = () =>
  report({
    subjects: [
      trLine("Mathematics", 4, 1, 3, 1, 12, 61), // 21/100
      trLine("English Language", 6, 2, 4, 2, 20, 64), // 34
      trLine("Yoruba", 8, 4, 6, 3, 42, 58), // 63
    ],
    summary: { total: 118, percentage: 39.3, grade: "F", remark: "FAIL", gpa: null, position: 21, rankedCount: 22, principalRemark: null },
    attendance: { opened: 120, present: 84, absent: 36 },
    skills: skills({ punctuality: 2, concentration: 2, contribution: 3, organisation: 3, handwriting: 3, fluency: 3, sports: 5, neatness: 3, teamwork: 4, leadership: 3, interpersonal: 4, initiative: 3 }),
    skillsTotal: 38,
  });

describe("an honest summary for a failing result", () => {
  const r = buildInsights(failing());

  it("states the fail plainly with the numbers", () => {
    assert.equal(r.headline.tone, "bad");
    assert.match(r.headline.text, /39\.3%/);
    assert.match(r.headline.text, /below the pass mark of 49\.5%/);
    assert.match(r.headline.text, /Mathematics/);
  });

  it("never praises", () => {
    assert.doesNotMatch(allText(r), PRAISE);
  });

  it("names the failing subjects with marks and the class average", () => {
    const weak = r.sections.find((s) => s.id === "weak")!;
    assert.ok(weak.items.some((i) => /Mathematics: 21%/.test(i) && /below the class average of 61/.test(i)));
    assert.ok(weak.items.some((i) => /English Language: 34%/.test(i)));
  });

  it("says how many points are needed to pass", () => {
    assert.match(r.sections.find((s) => s.id === "overall")!.items.join(" "), /10\.2 more points/);
  });

  it("does not call the one passing subject a strength, only a relative one", () => {
    const s = r.sections.find((x) => x.id === "strong");
    assert.equal(s?.title ?? "Relatively stronger subjects", "Relatively stronger subjects");
  });
});

describe("position in class", () => {
  it("gives the position, the band and the total", () => {
    const pos = (position: number) => buildInsights(report({ ...failing(), summary: { ...failing().summary, position, rankedCount: 22 } })).sections[0].items.join(" ");
    assert.match(pos(2), /2nd out of 22, in the top 10%/);
    assert.match(pos(7), /7th out of 22, in the top third/); // 7 / 22 = 32%
    assert.match(pos(11), /11th out of 22, in the middle third/);
    assert.match(pos(21), /21st out of 22, in the bottom third/);
  });

  it("notes when the ranking spans the whole level", () => {
    const r = buildInsights(report({ ...failing(), classSize: 10, summary: { ...failing().summary, position: 3, rankedCount: 30 } }));
    assert.match(r.sections[0].items.join(" "), /every class in your level/);
  });

  it("explains that progress reports have no position", () => {
    const r = buildInsights(report({ milestone: "PR1", subjects: [prLine("Mathematics", 6, 3, 8, 55, 60)], summary: { total: 1, percentage: 55, grade: "D", remark: "", gpa: null, position: null, rankedCount: null, principalRemark: null } }));
    assert.match(r.sections[0].items.join(" "), /only on the terminal result/);
  });

  it("orders suffixes correctly", () => {
    const got = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal);
    assert.deepEqual(got, ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
  });
});

describe("exam versus coursework", () => {
  it("spots good coursework wasted in the exam", () => {
    const r = buildInsights(report({ subjects: [trLine("Biology", 9, 5, 9, 5, 18, 60), trLine("Chemistry", 9, 4, 9, 4, 20, 58), trLine("Physics", 8, 4, 9, 5, 22, 57)], summary: { total: 0, percentage: 46, grade: "F", remark: "", gpa: null, position: 12, rankedCount: 20, principalRemark: null } }));
    const weak = r.sections.find((s) => s.id === "weak")!;
    assert.ok(weak.items.some((i) => /far below classwork and tests/.test(i)), "weak items should explain the exam gap");
    const marks = r.sections.find((s) => s.id === "marks")!;
    assert.match(marks.items.join(" "), /lower than coursework/);
    assert.match(marks.items.join(" "), /timed past questions/);
  });

  it("spots marks lost in coursework instead", () => {
    const r = buildInsights(report({ subjects: [trLine("Biology", 2, 1, 2, 0, 60, 60), trLine("Chemistry", 3, 1, 2, 1, 58, 58), trLine("Physics", 2, 1, 3, 0, 61, 57)], summary: { total: 0, percentage: 70, grade: "B", remark: "", gpa: null, position: 3, rankedCount: 20, principalRemark: null } }));
    assert.match(r.sections.find((s) => s.id === "marks")!.items.join(" "), /submit every piece of work/);
  });
});

describe("attendance", () => {
  const withAttendance = (present: number) => buildInsights(report({ ...failing(), attendance: { opened: 120, present, absent: 120 - present } }));

  it("calls poor attendance a serious problem and links it to weak subjects", () => {
    const a = withAttendance(84).sections.find((s) => s.id === "attendance")!;
    assert.equal(a.tone, "bad");
    assert.match(a.items.join(" "), /serious problem/);
    assert.match(a.items.join(" "), /contributing to the weak results in Mathematics/);
  });

  it("does not raise an alarm at 93%", () => {
    const a = withAttendance(112).sections.find((s) => s.id === "attendance")!;
    assert.equal(a.tone, "neutral");
    assert.doesNotMatch(a.items.join(" "), /serious|too many/);
  });

  it("asks for a target between 80% and 90%", () => {
    assert.match(withAttendance(102).sections.find((s) => s.id === "attendance")!.items.join(" "), /too many/);
  });
});

describe("personal skills and psychomotor habits", () => {
  const r = buildInsights(failing());
  const s = r.sections.find((x) => x.id === "skills")!;

  it("reports the average and separates the affective and psychomotor domains", () => {
    assert.match(s.items[0], /Personal skills average 3\.2\/5 \(total 38\/60\)/);
    // affective: (2+2+3+3+4+3+4+3) / 8 = 3.0; psychomotor: (3+3+5+3) / 4 = 3.5
    assert.ok(s.items.some((i) => /Affective domain .* averages 3\/5/.test(i) && /Psychomotor domain \(handwriting, fluency, sports, neatness\) averages 3\.5\/5/.test(i)));
    assert.ok(s.items.some((i) => /affective domain is the weaker one by 0\.5 points/.test(i)));
  });

  it("names the lowest skills with scores and gives specific advice for them", () => {
    assert.ok(s.items.some((i) => /Lowest: .*Punctuality \(2\).*Concentration \(2\)/.test(i)));
    assert.ok(s.items.some((i) => /^Punctuality: Be at school before assembly/.test(i)));
    assert.ok(s.items.some((i) => /^Concentration: Sit near the front/.test(i)));
  });

  it("links low concentration to the weak subjects and low punctuality to attendance", () => {
    assert.ok(s.items.some((i) => /Low concentration \(2\/5\) fits the weak results/.test(i)));
    assert.ok(s.items.some((i) => /Punctuality \(2\/5\) and attendance \(70%\)/.test(i)));
  });

  it("is absent when no skills were recorded", () => {
    assert.equal(buildInsights(report({ ...failing(), skills: null })).sections.find((x) => x.id === "skills"), undefined);
  });
});

describe("a passing, stronger student", () => {
  const good = report({
    subjects: [trLine("Mathematics", 9, 5, 9, 5, 60, 62), trLine("English Language", 8, 4, 8, 4, 55, 60), trLine("Yoruba", 7, 4, 7, 3, 40, 58)],
    summary: { total: 0, percentage: 82, grade: "B", remark: "", gpa: null, position: 2, rankedCount: 22, principalRemark: null },
    attendance: { opened: 120, present: 118, absent: 2 },
  });
  const r = buildInsights(good);

  it("is marked good and shows the strong subjects with the margin over the class", () => {
    assert.equal(r.headline.tone, "good");
    const strong = r.sections.find((x) => x.id === "strong")!;
    assert.equal(strong.title, "Strong areas");
    assert.match(strong.items[0], /Mathematics: 88%/);
    assert.match(strong.items[0], /points above the class average of 62/);
  });

  it("has no urgent actions and does not invent problems", () => {
    const next = r.sections.find((x) => x.id === "next")!;
    assert.match(next.items.join(" "), /no subject needs urgent action|aiming to reach/);
    assert.equal(r.sections.find((x) => x.id === "attendance")!.tone, "good");
  });
});

describe("change since the previous report", () => {
  const prev = report({ milestone: "PR3", subjects: [prLine("Mathematics", 9, 5, 9, 90, 60), prLine("Yoruba", 5, 2, 4, 40, 55), prLine("English Language", 7, 3, 7, 70, 60)] });
  const now = report({
    subjects: [trLine("Mathematics", 4, 2, 4, 2, 30, 60), trLine("Yoruba", 8, 4, 8, 4, 40, 55), trLine("English Language", 7, 3, 7, 3, 45, 60)],
    summary: { total: 0, percentage: 55, grade: "C", remark: "", gpa: null, position: 10, rankedCount: 20, principalRemark: null },
  });
  const t = buildInsights(now, prev).sections.find((s) => s.id === "trend")!;

  it("flags the biggest fall and the biggest rise with both numbers", () => {
    assert.match(t.items.join(" "), /Mathematics fell from 90% to 40%/);
    assert.match(t.items.join(" "), /Yoruba rose from 40% to 80%/);
  });
});

describe("progress data", () => {
  it("compares progress reports and the terminal result on classwork only", () => {
    const pr = report({ milestone: "PR3", subjects: [prLine("A", 9, 4, 8, 80, 60), prLine("B", 6, 3, 6, 60, 60)] });
    const tr = report({ subjects: [trLine("A", 9, 4, 8, 4, 50, 60), trLine("B", 6, 3, 6, 3, 40, 60)], summary: { ...failing().summary, percentage: 72.5 } });
    const series = progressSeries({ PR3: pr, TR: tr });
    assert.deepEqual(series.map((p) => p.milestone), ["PR3", "TR"]);
    assert.equal(series[0].coursework, 70);
    assert.equal(series[1].overall, 72.5);
    assert.ok(Math.abs(caPercent(tr.subjects[0], "TR") - 83.3333) < 0.001); // (9 + 4 + 8 + 4) / 30
    assert.equal(scoreOf(tr.subjects[0], "TR"), 75);
  });
});
