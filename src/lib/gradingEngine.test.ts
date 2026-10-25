import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateGPA,
  calculatePR1,
  calculateTR,
  emptyRawScores,
  getGradeAndRemark,
  isSeniorClass,
  validateRawScores,
  weeksForFrequency,
  type RawScores,
} from "./gradingEngine";

const perfect = (): RawScores => ({
  cw: Array(10).fill("10"),
  hw: Array(10).fill("10"),
  tests: ["15", "15", "30"],
  project: "5",
  exam: "70",
});

describe("terminal result maths", () => {
  it("gives 100 and an A for perfect scores", () => {
    const tr = calculateTR(perfect());
    assert.deepEqual(tr.scaled, { cw: 10, hw: 5, tests: 10, project: 5, exam: 70 });
    assert.equal(tr.totalScore, 100);
    assert.equal(tr.grade, "A");
    assert.equal(tr.hasData, true);
  });

  it("gives 0, an F and no data for an empty sheet", () => {
    const tr = calculateTR(emptyRawScores());
    assert.equal(tr.totalScore, 0);
    assert.equal(tr.grade, "F");
    assert.equal(tr.hasData, false);
  });

  it("caps project and exam at their maximums", () => {
    const tr = calculateTR({ ...perfect(), project: "9", exam: "99" });
    assert.equal(tr.scaled.project, 5);
    assert.equal(tr.scaled.exam, 70);
  });

  it("adds the components into the total", () => {
    const raw: RawScores = { cw: Array(10).fill("9"), hw: Array(10).fill("8"), tests: ["12", "12", "24"], project: "4", exam: "56" };
    const tr = calculateTR(raw);
    assert.equal(tr.scaled.cw, 9);
    assert.equal(tr.scaled.hw, 4); // homework is out of 5: an average of 8/10 scores 4
    const sum = tr.scaled.cw + tr.scaled.hw + tr.scaled.tests + tr.scaled.project + tr.scaled.exam;
    assert.ok(Math.abs(tr.totalScore - sum) < 0.02, `total ${tr.totalScore} should equal the sum of its parts ${sum}`);
  });
});

describe("grade bands", () => {
  it("uses the junior boundaries exactly", () => {
    assert.equal(getGradeAndRemark(89.5).grade, "A");
    assert.equal(getGradeAndRemark(89.49).grade, "B");
    assert.equal(getGradeAndRemark(79.5).grade, "B");
    assert.equal(getGradeAndRemark(59.5).grade, "C");
    assert.equal(getGradeAndRemark(49.5).grade, "D");
    assert.equal(getGradeAndRemark(49.49).grade, "F");
  });

  it("uses the senior boundaries exactly", () => {
    assert.equal(getGradeAndRemark(75, true).grade, "A");
    assert.equal(getGradeAndRemark(74.99, true).grade, "B");
    assert.equal(getGradeAndRemark(50, true).grade, "C");
    assert.deepEqual(getGradeAndRemark(40, true), { grade: "D", remark: "WEAK" });
    assert.equal(getGradeAndRemark(39.99, true).grade, "F");
  });
});

describe("weekly and fortnightly classwork", () => {
  it("schedules fortnightly subjects on weeks 2, 4, 6, 8, 10", () => {
    assert.deepEqual(weeksForFrequency("fortnightly").cw, [2, 4, 6, 8, 10]);
    assert.equal(weeksForFrequency("weekly").cw.length, 10);
  });

  it("averages only the weeks that were entered", () => {
    const weeks = weeksForFrequency("fortnightly");
    const bothEntered = { ...emptyRawScores(), cw: ["", "10", "", "0", "", "", "", "", "", ""] };
    const oneBlank = { ...emptyRawScores(), cw: ["", "10", "", "", "", "", "", "", "", ""] };
    assert.equal(calculatePR1(bothEntered, false, weeks).cw, 5); // (10 + 0) / 2
    assert.equal(calculatePR1(oneBlank, false, weeks).cw, 10); // a blank week is not counted as 0
  });
});

describe("score validation", () => {
  it("rejects scores above each maximum", () => {
    assert.equal(validateRawScores({ cw: ["11"] }).valid, false);
    assert.equal(validateRawScores({ hw: ["10.5"] }).valid, false);
    assert.equal(validateRawScores({ tests: ["15", "16", "30"] }).valid, false);
    assert.equal(validateRawScores({ tests: ["15", "15", "31"] }).valid, false);
    assert.equal(validateRawScores({ project: "6" }).valid, false);
    assert.equal(validateRawScores({ exam: "71" }).valid, false);
  });

  it("rejects negatives and non-numbers but ignores blanks", () => {
    assert.equal(validateRawScores({ cw: ["-1"] }).valid, false);
    assert.equal(validateRawScores({ cw: ["abc"] }).valid, false);
    assert.equal(validateRawScores({ cw: ["", "10"], tests: ["", "", ""], project: "", exam: "" }).valid, true);
  });

  it("accepts the maximums", () => {
    assert.equal(validateRawScores(perfect()).valid, true);
  });
});

describe("helpers", () => {
  it("recognises senior classes", () => {
    assert.equal(isSeniorClass("SSS 1 Arts"), true);
    assert.equal(isSeniorClass("JSS 1"), false);
    assert.equal(isSeniorClass("ZZ Test Class"), false);
  });

  it("works out GPA out of 5 weighted by credit units", () => {
    assert.equal(calculateGPA([{ total: 80, creditUnit: 2 }, { total: 60, creditUnit: 2 }]), 3.5);
    assert.equal(calculateGPA([]), null);
  });
});
