import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STUDENT_PASSWORD, approvedMessage, enrolApplicant, enrolledMessage, loginEmailFor, rejectedMessage } from "./admissionsServer";

describe("student login email", () => {
  it("is the admission number with only letters and numbers, lower case", () => {
    assert.equal(loginEmailFor("GMA1701"), "gma1701@student.gracemark.edu.ng");
    assert.equal(loginEmailFor(" GMA-17/01 "), "gma1701@student.gracemark.edu.ng");
  });
});

describe("emails to the parent", () => {
  it("the enrolment email carries the admission number, password and portal address", () => {
    const m = enrolledMessage("Ade Bola", "JSS 1", "GMA2601");
    assert.match(m.message, /GMA2601/);
    assert.ok(m.message.includes(DEFAULT_STUDENT_PASSWORD));
    assert.match(m.message, /gracemarkportal\.com\.ng/);
    assert.match(m.message, /JSS 1/);
  });

  it("the rejection email includes the reason and says the fee is kept", () => {
    const m = rejectedMessage("Ade Bola", "ADM-2026-ABC123", "No space in that class");
    assert.match(m.message, /No space in that class/);
    assert.match(m.message, /not refundable/);
  });

  it("the rejection email still reads well without a reason", () => {
    assert.doesNotMatch(rejectedMessage("Ade Bola", "ADM-1", "").message, /Reason:/);
  });

  it("the approval email names the application", () => {
    assert.match(approvedMessage("Ade Bola", "JSS 1", "ADM-2026-ABC123").subject, /ADM-2026-ABC123/);
  });
});

describe("enrolling an applicant", () => {
  // These are refused before the database is touched, so a stand-in that throws proves no call is made.
  const untouched = new Proxy({}, { get: () => { throw new Error("the database must not be touched"); } }) as any;

  it("rejects a badly formed admission number straight away", async () => {
    for (const admissionNo of ["", "A", "GMA 1701", "GMA#1701", "-GMA1", "G".repeat(31)]) {
      const r = await enrolApplicant(untouched, { admissionId: "x", admissionNo, classId: "y" });
      assert.equal(r.ok, false, `"${admissionNo}" should be refused`);
      assert.equal((r as any).status, 400);
    }
  });
});
