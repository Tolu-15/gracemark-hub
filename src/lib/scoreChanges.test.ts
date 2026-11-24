import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawScores } from "./gradingEngine";
import { changedMarks, mergeMarks } from "./scoreChanges";

test("a single test edit round trips without resending homework, and zero differs from clearing", () => {
  const raw = emptyRawScores();
  raw.hw[7] = 9;
  const edit = { field: "tests" as const, index: 2, value: 0 };
  const result = mergeMarks({ score_breakdown: raw }, [edit]);
  assert.deepEqual(changedMarks(raw, result), [edit]);
  assert.equal(raw.tests[2], "");
  assert.equal(result.hw[7], 9);
  assert.deepEqual(changedMarks(result, raw), [{ ...edit, value: "" }]);
});
