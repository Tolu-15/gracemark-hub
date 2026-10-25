import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { clearSettingsCache, getCardSettings, getMaintenance, parseCardSettings, parseMaintenance } from "./systemSettings";

/** Stands in for the database client: returns whatever row (or error) the test sets up. */
const fakeService = (result: { data?: any; error?: any }) =>
  ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }) }) }) }) }) as any;

// Settings are cached for a few seconds per key, so every test starts from a clean cache.
beforeEach(() => clearSettingsCache());
afterEach(() => {
  clearSettingsCache();
  delete process.env.SCRATCH_CARD_ONLINE_ENABLED;
});

describe("card settings from the database", () => {
  it("uses what the developer saved", async () => {
    const s = await getCardSettings(fakeService({ data: { value: { price: 1500, viewsAllowed: 3, onlineEnabled: true } } }));
    assert.deepEqual(s, { price: 1500, viewsAllowed: 3, onlineEnabled: true });
  });

  it("falls back to ₦1,000 and 5 views if the table is missing or the read fails", async () => {
    const s = await getCardSettings(fakeService({ error: { message: "relation does not exist" } }));
    assert.deepEqual(s, { price: 1000, viewsAllowed: 5, onlineEnabled: false });
  });

  it("ignores silly stored values instead of charging them", async () => {
    const s = await getCardSettings(fakeService({ data: { value: { price: 5, viewsAllowed: 0 } } }));
    assert.equal(s.price, 1000);
    assert.equal(s.viewsAllowed, 5);
  });

  it("follows the environment flag until a developer sets online sales", async () => {
    process.env.SCRATCH_CARD_ONLINE_ENABLED = "true";
    const s = await getCardSettings(fakeService({ data: { value: { price: 1000, viewsAllowed: 5 } } }));
    assert.equal(s.onlineEnabled, true);
  });

  it("lets a stored online setting override the environment flag", async () => {
    process.env.SCRATCH_CARD_ONLINE_ENABLED = "true";
    const s = await getCardSettings(fakeService({ data: { value: { price: 1000, viewsAllowed: 5, onlineEnabled: false } } }));
    assert.equal(s.onlineEnabled, false);
  });
});

describe("maintenance settings", () => {
  it("is off when nothing is stored", async () => {
    assert.equal((await getMaintenance(fakeService({}))).enabled, false);
  });

  it("is off when the read fails, so a settings outage never locks people out", async () => {
    assert.equal((await getMaintenance(fakeService({ error: { message: "down" } }))).enabled, false);
  });

  it("only turns on for an explicit true", () => {
    const off = parseMaintenance({ enabled: "yes" }) as any;
    assert.equal(off.value.enabled, false);
    const on = parseMaintenance({ enabled: true, message: "  Back soon  ", allowAdmins: true }) as any;
    assert.deepEqual(on.value, { enabled: true, message: "Back soon", backAt: null, allowAdmins: true });
  });

  it("rejects an invalid expected-back time", () => {
    assert.ok("error" in (parseMaintenance({ enabled: true, backAt: "not a date" }) as object));
  });
});

describe("validating card settings input", () => {
  it("accepts a sensible price and views", () => {
    assert.deepEqual(parseCardSettings({ price: 1200, viewsAllowed: 4, onlineEnabled: true }), { value: { price: 1200, viewsAllowed: 4, onlineEnabled: true } });
  });

  it("rejects prices outside ₦50 to ₦1,000,000", () => {
    for (const price of [10, 2_000_000, "1000"]) assert.ok("error" in (parseCardSettings({ price, viewsAllowed: 5 }) as object), `price ${price}`);
  });

  it("rejects views that are not whole numbers from 1 to 50", () => {
    for (const viewsAllowed of [0, 2.5, 51]) assert.ok("error" in (parseCardSettings({ price: 1000, viewsAllowed }) as object), `views ${viewsAllowed}`);
  });

  it("only keeps onlineEnabled when it is a real boolean", () => {
    assert.deepEqual(parseCardSettings({ price: 1000, viewsAllowed: 5, onlineEnabled: "true" }), { value: { price: 1000, viewsAllowed: 5 } });
  });
});
