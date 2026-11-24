import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyCardPayment, generatePin, generateSerial, hashPin, isCardIssuer, issuerEmails, normalizePin, spendView } from "./scratchCards";

/** A tiny in-memory stand-in for the database client: just the calls spendView makes. */
function fakeCards(rows: Record<string, any>[]) {
  class Query {
    private filters: [string, unknown][] = [];
    private mode: "select" | "update" = "select";
    private patch: Record<string, any> = {};
    select() {
      return this;
    }
    update(patch: Record<string, any>) {
      this.mode = "update";
      this.patch = patch;
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push([col, val]);
      return this;
    }
    private match() {
      return rows.filter((r) => this.filters.every(([c, v]) => r[c] === v));
    }
    async maybeSingle() {
      const row = this.match()[0];
      return { data: row ? { ...row } : null, error: null };
    }
    then(resolve: (v: any) => void) {
      const hit = this.match();
      if (this.mode === "update") hit.forEach((r) => Object.assign(r, this.patch));
      resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
    }
  }
  return { from: () => new Query() } as any;
}

const card = (over: Record<string, any> = {}) => ({ id: "c1", status: "active", views_used: 0, views_allowed: 5, ...over });

describe("PINs and serials", () => {
  const PIN = /^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){2}$/;

  it("makes PINs from characters that cannot be misread", () => {
    for (let i = 0; i < 200; i++) assert.match(generatePin(), PIN);
  });

  it("never repeats across a large batch", () => {
    const seen = new Set(Array.from({ length: 5000 }, generatePin));
    assert.equal(seen.size, 5000);
  });

  it("makes serials in the card format", () => {
    assert.match(generateSerial(), /^GMC-[A-HJKMNP-Z2-9]{8}$/);
  });

  it("normalises case, dashes and spaces before hashing", () => {
    assert.equal(normalizePin(" abcd-efgh jkmn "), "ABCDEFGHJKMN");
    assert.equal(hashPin("abcd-efgh-jkmn"), hashPin("ABCDEFGHJKMN"));
    assert.notEqual(hashPin("ABCD-EFGH-JKMN"), hashPin("ABCD-EFGH-JKMP"));
    assert.match(hashPin("ABCD-EFGH-JKMN"), /^[0-9a-f]{64}$/);
  });
});

describe("who may issue cards", () => {
  const saved = process.env.SCRATCH_CARD_ISSUER_EMAILS;
  afterEach(() => {
    if (saved === undefined) delete process.env.SCRATCH_CARD_ISSUER_EMAILS;
    else process.env.SCRATCH_CARD_ISSUER_EMAILS = saved;
  });

  it("falls back to the two named issuers", () => {
    delete process.env.SCRATCH_CARD_ISSUER_EMAILS;
    assert.deepEqual(issuerEmails(), ["toluwanimibabalola2707@gmail.com", "gracemarkacademy@gmail.com"]);
  });

  it("can be overridden and ignores case", () => {
    process.env.SCRATCH_CARD_ISSUER_EMAILS = "a@x.com, B@x.com";
    assert.deepEqual(issuerEmails(), ["a@x.com", "b@x.com"]);
    assert.equal(isCardIssuer({ role: "admin", email: "B@X.COM" } as any), true);
  });

  it("only lets admins on the list issue", () => {
    process.env.SCRATCH_CARD_ISSUER_EMAILS = "a@x.com";
    assert.equal(isCardIssuer({ role: "teacher", email: "a@x.com" } as any), false);
    assert.equal(isCardIssuer({ role: "admin", email: "other@x.com" } as any), false);
    assert.equal(isCardIssuer({ role: "admin" } as any), false);
  });
});

describe("unlimited term access", () => {
  it("allows repeated opens without deductions, including previously exhausted cards", async () => {
    for (const status of ["active", "exhausted"]) {
      const rows = [card({ status, views_used: 5 })];
      for (let i = 0; i < 10; i++) assert.ok(await spendView(fakeCards(rows), "c1"));
      assert.equal(rows[0].views_used, 5);
      assert.equal(rows[0].status, status);
    }
  });
  it("still refuses unactivated, revoked and missing cards", async () => {
    for (const status of ["issued", "revoked"]) assert.equal(await spendView(fakeCards([card({status})]), "c1"), null);
    assert.equal(await spendView(fakeCards([]), "missing"), null);
  });
});

describe("payment confirmation", () => {
  it("refuses unsuccessful or non-NGN payments before accessing orders", async () => {
    for (const txn of [{ status: "failed", currency: "NGN" }, { status: "success", currency: "USD" }]) {
      const result = await applyCardPayment({ from() { throw new Error("must not query"); } } as any, txn);
      assert.equal(result.ok, false);
    }
  });
});
