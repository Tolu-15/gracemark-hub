// Preloaded by scripts/run-tests.js: makes the app's "@/..." imports resolve inside the compiled test build.
const Module = require("module");
const path = require("path");

// Node 20 has no built-in WebSocket, and the database client insists on one when it is created (it is
// never used by these tests). A placeholder lets the code under test load. Tests only; the app is unchanged.
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class WebSocket {};

const buildRoot = process.env.TEST_BUILD_DIR || path.join(__dirname, "..", ".test-build");
const original = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = path.join(buildRoot, "src", request.slice(2));
  }
  return original.call(this, request, ...rest);
};
