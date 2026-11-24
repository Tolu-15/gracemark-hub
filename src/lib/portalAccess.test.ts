import * as deviceTrust from "./otp";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import * as db from "./supabase/server";
import * as financeService from "./financeServer";
import { PATCH as setSchoolDays } from "../app/api/admin/term-setup/route";
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
  t.mock.method(deviceTrust, "trustsDevice", () => true);
  const tables: Record<string, Record<string, any>[]> = {
    users: [{ id: "profile", auth_id: "viewer", role }], system_settings: [],
    students: [{ id: "pupil", user_id: "viewer", class_id: "A", portal_access_status: "open" }],
    app_settings: [{ current_term: "term1", current_session: "now" }],
    classes: [{ id: "A", name: "JSS 1" }], class_teacher_assignments: [],
    academic_sessions: [{ id: "now-id", name: "now", is_current: true }, { id: "old-id", name: "old" }],
    subject_teacher_assignments: [{ id: "assignment", teacher_user_id: "profile", class_id: "A",
      subject_id: "maths", academic_session_id: "now-id", status: "active" }],
    scratch_card_history: [], scratch_cards: [], scratch_card_purchases: [], audit_logs: [],
    results: [], academic_terms: [], student_subject_optouts: [], payment_transactions: [],
    student_enrollments: [{ id: "enr", student_id: "pupil", class_id: "A", academic_session_id: "old-id",
      academic_sessions: { name: "old" }, classes: { name: "JSS 1" } }],
    result_snapshots: [{ enrollment_id: "enr", term: "term1", report_type: "PR1", snapshot_data: { frozen: true } }],
  };
  const writes: { table: string; value: any }[] = [];
  const service = { auth: { getUser: async (token: string) => ({
    data: { user: token === "fixture" ? { id: "viewer", email: "student@example.test", user_metadata: { role: "admin" } } : null },
  }) },
    async rpc(name: string, args: { p_records: unknown[] }) {
      if (name === "set_current_school_days") {
        writes.push({ table: "school_days", value: args });
        return { error: null };
      }
      assert.equal(name, "save_score_edits");
      writes.push({ table: "results", value: args.p_records });
      return { error: null };
    }, from(table: string) {
    assert.ok(table in tables, "Unexpected database access to " + table);
    let rows = tables[table];
    let patch: Record<string, unknown> | undefined;
    let error: { code: string } | null = null;
    const q = {
      select() { return q; }, order() { return q; }, limit(n: number) { rows = rows.slice(0, n); return q; },
      eq(k: string, v: unknown) { rows = rows.filter(r => r[k] === v); return q; },
      in(k: string, vs: unknown[]) { rows = rows.filter(r => vs.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0], error: error ?? (rows.length === 1 ? null : "Expected one row") }),
      upsert: async (value: any) => { writes.push({ table, value }); return { error: null }; },
      insert(value: any) {
        if (value.payment_reference && tables[table].some(row => row.payment_reference === value.payment_reference)) {
          error = { code: "23505" };
        } else {
          const row = { id: table + "-" + tables[table].length, ...value };
          tables[table].push(row);
          rows = [row];
        }
        return q;
      },
      update(value: Record<string, unknown>) { patch = value; return q; },
      throwOnError() {
        if (error) throw error;
        if (patch) rows.forEach(row => Object.assign(row, patch));
        return Promise.resolve({ data: rows, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        if (patch && !error) rows.forEach(row => Object.assign(row, patch));
        return Promise.resolve({ data: rows, error }).then(resolve);
      },
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

const newVersion = "00000000-0000-4000-8000-000000000001";
const oldVersion = "00000000-0000-4000-8000-000000000002";
const edit = { student_id: "pupil", expected: null as string | null, next: newVersion,
  changes: [{ field: "exam", index: 0, value: "0" }], clear: false };
const sheet = { class_id: "A", subject_id: "maths", session: "now", term: "term1" };
const payload = { protocol: 2, sheet, edits: [edit], submit: false };

test("score patches enforce the assignment and roster, preserve zero and reject old clients", async t => {
  const { writes } = fixture(t, "teacher");
  assert.equal((await save(request("/", { records: [score] }))).status, 409);
  for (const override of [{ class_id: "B" }, { session: "old" }]) {
    assert.equal((await save(request("/", { ...payload, sheet: { ...sheet, ...override } }))).status, 403);
  }
  assert.equal((await save(request("/", { ...payload, edits: [{ ...edit, student_id: "another" }] }))).status, 403);
  assert.equal(writes.length, 0);
  assert.equal((await save(request("/", payload))).status, 200);
  assert.equal(writes[0].value[0].exam, 0);
  assert.equal(writes[0].value[0].grade, "F");
});

test("a stale patch is rejected and a current patch preserves other assessments", async t => {
  const { tables, writes } = fixture(t, "teacher");
  const raw = emptyRawScores();
  raw.cw[7] = 8;
  tables.results.push({ ...score, score_version: oldVersion, score_breakdown: raw });
  assert.equal((await save(request("/", payload))).status, 409);
  assert.equal(writes.length, 0);
  assert.equal((await save(request("/", { ...payload, edits: [{ ...edit, expected: oldVersion }] }))).status, 200);
  assert.equal(writes[0].value[0].score_breakdown.cw[7], 8);
  assert.equal(writes[0].value[0].score_breakdown.exam, "0");
});

test("clearing a published row and invalid test indices are rejected", async t => {
  const { tables, writes } = fixture(t, "admin");
  tables.results.push({ ...score, score_version: oldVersion, tr_status: "published" });
  const send = (changes: unknown[]) => save(request("/", { ...payload, edits: [{ ...edit, expected: oldVersion, clear: true, changes }] }));
  assert.equal((await send([{ field: "exam", index: 0, value: "" }])).status, 409);
  assert.equal((await send([{ field: "tests", index: 3, value: 2 }])).status, 400);
  assert.equal(writes.length, 0);
});

test("student finance rejects another pupil and report lookup uses the signed-in pupil's enrollment", async t => {
  const { tables } = fixture(t, "student");
  tables.students[0].class_id = "B";
  tables.classes.push({ id: "B", name: "JSS 2" });
  tables.student_enrollments[0].status = "promoted";
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

test("a view-only administrator cannot publish, promote or record payments", async t => {
  const { tables, writes } = fixture(t, "admin");
  tables.users[0].is_restricted_admin = true;
  for (const handler of [publish, promote, collect]) assert.equal((await handler(request("/", {}))).status, 403);
  assert.deepEqual(writes, []);
});

test("profile sync returns only the authenticated account's provisioned profile", async t => {
  const { POST: sync } = await import("../app/api/auth/sync-profile/route");
  const { tables, writes } = fixture(t, "student");
  assert.equal((await sync(request("/", {}, false))).status, 401);
  const expired = request("/", {});
  expired.headers.set("authorization", "Bearer expired-fixture");
  assert.equal((await sync(expired)).status, 401);
  const response = await sync(request("/", { authId: "other" }));
  const { profile } = await response.json();
  assert.equal(profile.auth_id, "viewer");
  assert.equal(profile.role, "student");
  tables.users = [];
  assert.equal((await sync(request("/", {}))).status, 403);
  assert.deepEqual(writes, []);
});

test("a restricted admin can read the permitted leaderboard but cannot read finance records", async t => {
  const { requireApiActor } = await import("./apiAuth");
  const { tables } = fixture(t, "admin");
  tables.users[0].is_restricted_admin = true;
  assert.ok("actor" in await requireApiActor(request("/api/admin/leaderboard"), ["admin"]));
  const denied = await requireApiActor(request("/api/admin/finance/payments"), ["admin"]);
  assert.ok("response" in denied);
  assert.equal(denied.response.status, 403);
});
test("checkout uses the order price and reference and returns the test checkout URL", async t => {
  const { POST: start } = await import("../app/api/student/scratch-card/start/route");
  const { tables } = fixture(t, "student");
  tables.result_snapshots[0].report_type = "TR";
  tables.scratch_cards = [];
  tables.scratch_card_purchases = [];
  const settings = await import("./systemSettings");
  settings.clearSettingsCache();
  tables.system_settings.push({ key: "scratch_card", value: { price: 1000, onlineEnabled: true } });
  const oldKey = process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_SECRET_KEY = "sk_test_fixture";
  t.after(() => {
    if (oldKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = oldKey;
    settings.clearSettingsCache();
  });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.paystack.co/transaction/initialize");
    const body = JSON.parse(String(init.body));
    assert.equal(body.amount, 100000);
    assert.equal(body.currency, "NGN");
    assert.equal(body.reference, tables.scratch_card_purchases[0].reference);
    return Response.json({status: true, data: {authorization_url: "https://checkout.paystack.com/fixture"}});
  });
  const response = await start(request("/", {session: "old", term: "term1", amount: 1}));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).authorizationUrl, "https://checkout.paystack.com/fixture");
  assert.equal(tables.scratch_cards.length, 0);
});

test("a restored card opens the published report repeatedly for its assigned term", async t => {
  const { POST: view } = await import("../app/api/student/scratch-card/view/route");
  const { tables } = fixture(t, "student");
  tables.result_snapshots[0].report_type = "TR";
  tables.scratch_cards = [{ id: "card", student_id: "pupil", academic_session_id: "old-id", term_code: "term1",
    status: "exhausted", views_used: 5, views_allowed: 5 }];
  tables.scratch_card_views = [];
  tables.audit_logs = [];
  for (let i = 0; i < 7; i++) {
    const response = await view(request("/", {session: "old", term: "term1"}));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).charged, false);
  }
  assert.equal(tables.scratch_cards[0].views_used, 5);
  tables.scratch_cards[0].status = "revoked";
  tables.scratch_cards.push({ ...tables.scratch_cards[0], id: "older", status: "exhausted" });
  assert.equal((await view(request("/", {session: "old", term: "term1"}))).status, 402);
});

test("a report saved in tab memory requires the same currently active card", async () => {
  const { getOpenedTr, openedTrKey, rememberOpenedTr, clearOpenedTr } = await import("./openedTrCache");
  const key = openedTrKey("pupil", "old", "term1");
  const card = { id: "card", serial: "fixture", status: "active", viewsAllowed: 5, viewsUsed: 5, viewsLeft: 0 };
  rememberOpenedTr(key, { report: { published: true }, card });
  assert.ok(getOpenedTr(key, card));
  assert.equal(getOpenedTr(key, null), null);
  assert.equal(getOpenedTr(key, { ...card, status: "revoked" }), null);
  assert.equal(getOpenedTr(key, { ...card, id: "replacement" }), null);
  clearOpenedTr();
});

test("returning to a term after checkout recovers the paid order even without a callback", async t => {
  const { POST: verify } = await import("../app/api/student/scratch-card/verify/route");
  const { POST: start } = await import("../app/api/student/scratch-card/start/route");
  const settings = await import("./systemSettings");
  const { tables } = fixture(t, "student");
  const reference = "GMC-paid";
  const order = { reference, amount: 1000, student_id: "pupil", academic_session_id: "old-id",
    term_code: "term1", status: "pending", created_at: new Date().toISOString() };
  tables.scratch_card_purchases = [
    { ...order, reference: "GMC-other-term", term_code: "term2" },
    { ...order, reference: "GMC-other-student", student_id: "other" }, order,
  ];
  tables.result_snapshots[0].report_type = "TR";
  tables.scratch_cards = [];
  tables.audit_logs = [];
  tables.system_settings.push({ key: "scratch_card", value: { price: 1000, onlineEnabled: true } });
  settings.clearSettingsCache();
  const oldKey = process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_SECRET_KEY = "sk_test_fixture";
  t.after(() => {
    if (oldKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = oldKey;
    settings.clearSettingsCache();
  });
  let paid = false;
  const gateway = t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(url, "https://api.paystack.co/transaction/verify/" + reference);
    return Response.json({ status: true, data: { reference, currency: "NGN", amount: 100000, status: paid ? "success" : "pending" } });
  });
  const unpaid = await report(request("/api/student/report?session=old&term=term1"));
  const unpaidInfo = (await unpaid.json()).tr;
  assert.equal(unpaidInfo.pendingReference, reference);
  assert.equal(unpaidInfo.card, null);
  const retry = await start(request("/api/student/scratch-card/start", { session: "old", term: "term1" }));
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).pendingReference, reference);
  assert.equal(tables.scratch_card_purchases.length, 3);
  paid = true;
  const result = await report(request("/api/student/report?session=old&term=term1"));
  assert.equal(result.status, 200);
  const paidInfo = (await result.json()).tr;
  assert.equal(paidInfo.card.status, "active");
  assert.equal(paidInfo.pendingReference, undefined);
  assert.equal(gateway.mock.callCount(), 3);
  assert.deepEqual(tables.scratch_card_purchases.map(row => row.status), ["pending", "pending", "success"]);
  assert.equal((await verify(request("/api/student/scratch-card/verify", { reference }))).status, 200);
  assert.equal((await start(request("/api/student/scratch-card/start", { session: "old", term: "term1" }))).status, 409);
  assert.equal(tables.scratch_cards.length, 1);
  assert.equal(tables.scratch_card_purchases.length, 3);
});

test("scratch-card refunds preserve access, enforce the amount received and reject stale edits", async t => {
  const { tables } = fixture(t, "admin");
  const { PATCH } = await import("../app/api/admin/scratch-cards/route");
  const cards = await import("./scratchCards");
  const row = { entry_id: "card", card_id: "card", purchase_id: null, received: 1000, refunded: 0 };
  tables.scratch_card_history.push(row);
  tables.scratch_cards.push({ id: "card", refunded_amount: 0, status: "revoked" });
  const record = (previous: number, refunded: number) => PATCH(new NextRequest("http://localhost/api/admin/scratch-cards", {
    method: "PATCH", headers: { authorization: "Bearer fixture" },
    body: JSON.stringify({ action: "record_refund", entryId: "card", previous, refunded })
  }));
  t.mock.method(cards, "isCardIssuer", () => false);
  assert.equal((await record(0, 250)).status, 403);
  t.mock.method(cards, "isCardIssuer", () => true);
  assert.equal((await record(0, 1001)).status, 400);
  assert.equal((await record(0, 250)).status, 200);
  row.refunded = 250;
  assert.equal((await record(0, 250)).status, 200);
  assert.equal((await record(0, 500)).status, 409);
  assert.deepEqual(tables.scratch_cards[0], { id: "card", refunded_amount: 250, status: "revoked" });
  assert.equal(tables.audit_logs.length, 1);
  tables.users[0].is_restricted_admin = true;
  assert.equal((await record(250, 500)).status, 403);
});

test("school days can be edited without advancing the term", async t => {
  const { writes } = fixture(t, "admin");
  const change = (school_days: unknown) => setSchoolDays(new NextRequest("http://localhost/api/admin/term-setup", {
    method: "PATCH", headers: { authorization: "Bearer fixture" },
    body: JSON.stringify({ session: "now", term: "term1", school_days }),
  }));
  for (const bad of [0, 251, 1.5, "92"]) assert.equal((await change(bad)).status, 400);
  assert.equal((await change(92)).status, 200);
  assert.deepEqual(writes, [{ table: "school_days", value: { p_session: "now", p_term: "term1", p_days: 92 } }]);
});

