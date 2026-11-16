import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import * as db from "./supabase/server";
import * as financeService from "./financeServer";
import { POST as save } from "../app/api/results/save/route";
import { GET as attendance, POST as register } from "../app/api/teacher/attendance/route";
import { POST as publish } from "../app/api/admin/results/publish/route";
import { POST as promote } from "../app/api/admin/promotions/execute/route";
import { GET as finance } from "../app/api/student/finance/route";
import { POST as collect } from "../app/api/admin/finance/manual-payment/route";
import { GET as report } from "../app/api/student/report/route";
import { GET as printClass } from "../app/api/admin/reports/bulk/route";
import { POST as feedback } from "../app/api/feedback/route";
import { GET as optouts } from "../app/api/results/optouts/route";
import { emptyRawScores } from "./gradingEngine";

function request(path: string, body?: unknown, signedIn = true) {
  return new NextRequest("http://localhost" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: signedIn ? { authorization: "Bearer fixture" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// In-memory fixtures implement only the filters exercised by these handlers.
// Every recorded write is test-local; unexpected data access fails the test.
function fixture(t: import("node:test").TestContext, role: string) {
  const tables: Record<string, Record<string, any>[]> = {
    users: [{ id: "profile", auth_id: "viewer", role }], system_settings: [],
    students: [{ id: "pupil", user_id: "viewer", class_id: "A", portal_access_status: "open" }],
    app_settings: [{ current_term: "term1", current_session: "now" }],
    classes: [{ id: "A", name: "JSS 1" }], class_teacher_assignments: [],
    academic_sessions: [{ id: "now-id", name: "now", is_current: true }, { id: "old-id", name: "old" }],
    subject_teacher_assignments: [{ id: "assignment", teacher_user_id: "profile", class_id: "A",
      subject_id: "maths", academic_session_id: "now-id", status: "active" }],
    results: [], academic_terms: [], student_subject_optouts: [], payment_transactions: [],
    student_enrollments: [{ id: "enr", student_id: "pupil", class_id: "A", academic_session_id: "old-id",
      academic_sessions: { name: "old" }, classes: { name: "JSS 1" } }],
    result_snapshots: [{ enrollment_id: "enr", term: "term1", report_type: "PR1", snapshot_data: { frozen: true } }],
  };
  const writes: { table: string; value: any }[] = [];
  const service = { auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) },
    async rpc(name: string, args: { p_records: unknown[] }) {
      assert.equal(name, "save_score_sheet");
      writes.push({ table: "results", value: args.p_records });
      return { error: null };
    }, from(table: string) {
    assert.ok(table in tables, "Unexpected database access to " + table);
    let rows = tables[table];
    const q = {
      select() { return q; }, order() { return q; }, limit(n: number) { rows = rows.slice(0, n); return q; },
      eq(k: string, v: unknown) { rows = rows.filter(r => r[k] === v); return q; },
      in(k: string, vs: unknown[]) { rows = rows.filter(r => vs.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0], error: rows.length === 1 ? null : "Expected one row" }),
      upsert: async (value: any) => { writes.push({ table, value }); return { error: null }; },
      insert: async (value: any) => {
        if (tables[table].some(row => row.payment_reference === value.payment_reference)) return { error: { code: "23505" } };
        tables[table].push(value);
        return { error: null };
      },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
    };
    return q;
  } };
  t.mock.method(db, "getServiceClient", () => service);
  return { tables, writes };
}

const score = { student_id: "pupil", class_id: "A", subject_id: "maths", session: "now", term: "term1",
  score_breakdown: { ...emptyRawScores(), exam: "0" }, grade: "A", exam: 70 };

test("an anonymous request and a student cannot publish, promote, collect cash or print a class", async t => {
  fixture(t, "student");
  for (const handler of [publish, promote, collect, printClass]) {
    assert.equal((await handler(request("/", undefined, false))).status, 401);
    assert.equal((await handler(request("/"))).status, 403);
  }
});

test("teachers cannot open another class register, edit its attendance or read its opt-outs", async t => {
  fixture(t, "teacher");
  assert.equal((await attendance(request("/?class_id=B&session=now"))).status, 403);
  assert.equal((await register(request("/", { action: "save_daily", records: [{ ...score, class_id: "B" }] }))).status, 403);
  assert.equal((await optouts(request("/?class_id=B&subject_id=maths&session=now"))).status, 403);
});

test("score entry enforces assignment, roster and canonical session before writing", async t => {
  const { writes } = fixture(t, "teacher");
  for (const row of [{ ...score, class_id: "B" }, { ...score, student_id: "another" }, { ...score, session: "old" }]) {
    assert.equal((await save(request("/", { records: [row] }))).status, 403);
  }
  assert.equal((await save(request("/", { records: [{ ...score, academic_session_id: "old-id" }] }))).status, 400);
  assert.equal(writes.length, 0);
  assert.equal((await save(request("/", { records: [score] }))).status, 200);
  assert.equal(writes[0].value[0].exam, 0);
  assert.equal(writes[0].value[0].grade, "F");
});

test("delete-only request cannot remove a locked historical score or a published one", async t => {
  const { tables } = fixture(t, "admin");
  tables.results.push({ ...score, id: "score", session: "old" });
  assert.equal((await save(request("/", { deletedResultIds: ["score"] }))).status, 403);
  Object.assign(tables.results[0], { session: "now", tr_status: "published" });
  assert.equal((await save(request("/", { deletedResultIds: ["score"] }))).status, 409);
});

test("student finance rejects another pupil and report lookup uses the signed-in pupil's enrollment", async t => {
  fixture(t, "student");
  assert.equal((await finance(request("/?student_id=another"))).status, 403);
  const response = await report(request("/?student_id=another&session=old&term=term1"));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.student.id, "pupil");
  assert.equal(data.student.className, "JSS 1");
  assert.equal(data.reports.PR1.frozen, true);
  assert.equal(data.reports.TR, null);
});

test("invalid feedback is rejected before contacting the verification or email provider", async () => {
  assert.equal((await feedback(request("/", { feedback_type: "suggestion", message: "" }))).status, 400);
  assert.equal((await feedback(request("/", null))).status, 400);
});

test("retrying a manual payment returns the original receipt and rejects a changed amount", async t => {
  const { tables } = fixture(t, "admin");
  t.mock.method(financeService, "buildStudentFinance", async () => ({ invoice: { id: "invoice", status: "issued" } }));
  t.mock.method(financeService, "evaluatePortalAccess", async () => ({}));
  const send = (amount: number) => {
    const req = request("/", { student_id: "pupil", amount, method: "cash" });
    req.headers.set("Idempotency-Key", "00000000-0000-4000-8000-000000000001");
    return collect(req);
  };
  const first = await send(100);
  const retry = await send(100);
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal((await first.json()).receipt_number, (await retry.json()).receipt_number);
  assert.equal((await send(200)).status, 409);
  assert.equal(tables.payment_transactions.length, 1);
});
