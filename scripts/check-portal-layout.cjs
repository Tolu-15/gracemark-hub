// Local browser smoke check with synthetic identities and intercepted API traffic.
// Usage: node scripts/check-portal-layout.cjs <playwright-core module path> <local port>
const { chromium } = require(process.argv[2] || "playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
require("@next/env").loadEnvConfig(root);
const origin = "http://127.0.0.1:" + Number(process.argv[3] || 3000);
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://kfdfplxidvgoffqrfipw.supabase.co").hostname.split(".")[0];
const student = { id: "fixture-student", name: "Fixture Student", admissionNo: "TEST", className: "JSS 1" };
const pr = { student, className: "JSS 1", session: "Fixture", term: "term1", termLabel: "First Term", milestone: "PR1",
  milestoneLabel: "Progress Report 1", classSize: 1, subjects: [], summary: { total: 0, percentage: 0, grade: "F" },
  skills: null, attendance: null, generatedAt: "2026-01-01" };
const roles = ["admin", "teacher", "student", "public"];
const widths = [375, 768, 1024, 1440];

function pages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? pages(path.join(dir, e.name)) : e.name === "page.tsx" ? [dir] : []);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  let measured = 0;
  let redirectCount = 0;
  try {
    for (const role of roles) {
      const ctx = await browser.newContext({ reducedMotion: "reduce", serviceWorkers: "block" });
      const uid = "00000000-0000-4000-8000-000000000001";
      const user = { id: uid, email: "fixture@example.invalid", role: "authenticated",
        aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01" };
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const enc = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
      const session = { user, expires_at: exp, expires_in: 3600, token_type: "bearer", refresh_token: "fixture",
        access_token: [enc({ alg: "HS256", typ: "JWT" }), enc({ sub: uid, role: "authenticated", exp }), "ZmFrZQ"].join(".") };
      await ctx.addInitScript(({ key, session, role }) => {
        if (role !== "public") localStorage.setItem(key, JSON.stringify(session));
        sessionStorage.setItem("gm_tdev_intro_seen", "1");
      }, { key: "sb-" + project + "-auth-token", session, role });
      await ctx.routeWebSocket("**/*", socket => socket.close());
      await ctx.route("**/*", route => {
        const url = new URL(route.request().url());
        const json = body => route.fulfill({ json: body, headers: { "access-control-allow-origin": "*" } });
        if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
        if (url.pathname.startsWith("/rest/v1/")) {
          const table = url.pathname.split("/").pop();
          const rows = table === "users" ? [{ id: uid, auth_id: uid, display_name: "Fixture", role, status: "active" }]
            : table === "students" && role === "student" ? [{ id: student.id, user_id: uid, portal_access_status: "open" }]
            : table === "app_settings" ? [{ current_session: "Fixture", current_term: "term1" }] : [];
          return json(route.request().headers().accept?.includes("vnd.pgrst.object") ? rows[0] || null : rows);
        }
        if (url.pathname === "/auth/v1/user") return json(user);
        if (url.origin !== origin) return route.abort();
        if (url.pathname === "/api/student/report") return json({ ok: true, student, session: "Fixture", term: "term1",
          sessions: ["Fixture"], reports: { PR1: pr, PR2: null, PR3: null, TR: null }, availableTerms: { term1: ["PR1"] }, tr: { published: false } });
        if (url.pathname === "/api/terms") return json({ ok: true, terms: [], current_term: "term1", current_session: "Fixture" });
        if (url.pathname === "/api/maintenance") return json({ enabled: false });
        // Other endpoints intentionally exercise their unavailable state without any real requests.
        return route.fulfill({ status: 503, json: { error: "Fixture service unavailable" } });
      });
      const page = await ctx.newPage();
      let target = "";
      page.on("pageerror", e => failures.push([target, e.name, e.message.slice(0, 140)]));
      const base = path.join(root, "src", "app");
      for (const dir of pages(base)) {
        target = "/" + path.relative(base, dir).split(path.sep).join("/");
        const group = target.split("/")[1];
        if ((roles.includes(group) ? group : "public") !== role) continue;
        await page.goto(origin + target, { waitUntil: "domcontentloaded" });
        if (role !== "public") {
          await page.locator("#portalSidebar").waitFor({ state: "attached", timeout: 6000 }).catch(() => {});
        }
        if (new URL(page.url()).pathname.replace(/\/$/, "") !== target.replace(/\/$/, "")) {
          redirectCount++;
          continue;
        }
        if (role !== "public" && !await page.locator("#portalSidebar").count()) {
          failures.push([target, "role page did not mount"]);
          continue;
        }
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          if (overflow > 1) failures.push([target, width, "document overflow", overflow]);
          measured++;
        }
        if (target === "/student/result") {
          await page.getByText("Fixture Student", { exact: false }).first().waitFor({ timeout: 5000 });
          await page.emulateMedia({ media: "print" });
          assert.ok((await page.pdf({ format: "A4" })).length > 1000);
          await page.emulateMedia({ media: "screen" });
        }
        if (target === "/teacher/score-entry") {
          await page.setViewportSize({ width: 768, height: 900 });
          const toggle = page.locator("#portalMobileHamburgerBtn");
          await toggle.click();
          assert.equal(await toggle.getAttribute("aria-expanded"), "true");
          await page.keyboard.press("Escape");
          assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        }
      }
      await ctx.close();
    }
    console.log(JSON.stringify({ measured, redirectCount, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
