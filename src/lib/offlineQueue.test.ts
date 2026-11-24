import assert from "node:assert/strict";
import { test } from "node:test";
import { enqueue, flushQueue, getQueue } from "./offlineQueue";
import { supabase } from "./supabase/client";

test("offline score saves survive failed retries and sync in order for the signed-in teacher", async t => {
  const storage = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  let owner = "teacher-a";
  t.mock.method(supabase.auth, "getSession", async () => ({ data: { session: { user: { id: owner }, access_token: owner + "-token" } } }));
  const score = (id: number) => ({ url: "/api/results/save", method: "POST", body: JSON.stringify({ id }), label: "Score sheet" });
  enqueue(owner, score(1));
  enqueue(owner, score(2));
  let status = 503;
  const sent: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer teacher-a-token");
    sent.push(String(init.body));
    return Response.json({ error: "Sheet is locked" }, { status });
  });
  owner = "teacher-b";
  await flushQueue();
  assert.equal(sent.length, 0);
  owner = "teacher-a";
  await flushQueue();
  assert.equal(getQueue(owner).length, 2);
  status = 409;
  await flushQueue();
  assert.equal(getQueue(owner)[0].lastError, "Sheet is locked");
  status = 200;
  await flushQueue();
  assert.deepEqual(sent.slice(-2), [score(1).body, score(2).body]);
  assert.deepEqual(getQueue(owner), []);
});
