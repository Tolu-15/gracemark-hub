// Runs the project's tests with Node's built-in test runner. Nothing to install: TypeScript compiles the
// *.test.ts files (and what they import) into .test-build, then Node runs them.   Usage: npm test
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, ".test-build");
fs.rmSync(out, { recursive: true, force: true });

const tsc = spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"], { cwd: root, stdio: "inherit" });
if (tsc.status !== 0) {
  console.error("\nThe tests did not compile.");
  process.exit(tsc.status || 1);
}

const find = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? find(p) : e.name.endsWith(".test.js") ? [p] : [];
  });
const files = fs.existsSync(path.join(out, "src")) ? find(path.join(out, "src")) : [];
if (!files.length) {
  console.error("No tests found.");
  process.exit(1);
}

const run = spawnSync(process.execPath, ["--require", path.join(__dirname, "test-alias.js"), "--test", "--test-reporter=spec", ...files], {
  cwd: root,
  stdio: "inherit",
  timeout: 180000,
  env: { ...process.env, TEST_BUILD_DIR: out },
});
if (run.error) console.error(run.error.message);
process.exit(run.status === null ? 1 : run.status);
