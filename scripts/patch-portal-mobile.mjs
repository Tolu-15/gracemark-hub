import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = [
  path.join(repo, "public"),
  path.join(repo, "admin"),
  path.join(repo, "teacher"),
  path.join(repo, "student"),
];

const LOGOUT_BLOCK = `
        <div class="p-4 border-t border-slate-800 mt-auto shrink-0">
            <button id="logoutBtn" type="button"
                class="flex items-center gap-3 w-full px-3 py-2.5 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1">
                    </path>
                </svg>
                Sign Out
            </button>
        </div>`;

const PORTAL_ASSETS = `
    <link rel="stylesheet" href="/assets/portal-layout.css" />
    <script type="module" src="/js/shared/portalShell.js"></script>`;

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, files);
    else if (name.endsWith(".html")) files.push(p);
  }
  return files;
}

function patchPortal(html) {
  if (!html.includes("hidden md:flex")) return html;

  let out = html;

  out = out.replace(
    /class="([^"]*)\bhidden md:flex\b([^"]*)"/,
    'id="portalSidebar" class="portal-sidebar $1$2"'
  );

  out = out.replace(
    /<body class="bg-slate-50 text-slate-800 h-screen overflow-hidden flex">/,
    '<body class="bg-slate-50 text-slate-800 portal-app flex min-h-[100dvh] overflow-hidden">'
  );
  out = out.replace(
    /<body class="bg-slate-50 text-slate-800 h-screen flex overflow-hidden">/,
    '<body class="bg-slate-50 text-slate-800 portal-app flex min-h-[100dvh] overflow-hidden">'
  );

  if (!out.includes('id="portalNavBackdrop"')) {
    out = out.replace(
      /(<body class="portal-app[^"]*">)/,
      `$1\n    <div id="portalNavBackdrop" class="portal-nav-backdrop" hidden></div>`
    );
  }

  out = out.replace(
    /<div class="p-6 border-b border-slate-800">\s*\n\s*<div class="flex items-center gap-3">/g,
    `<div class="p-6 border-b border-slate-800 flex items-center justify-between gap-2">
            <div class="portal-sidebar-brand flex items-center gap-3 min-w-0">`
  );

  if (!out.includes('id="logoutBtn"')) {
    out = out.replace(/(\s*)<\/aside>/, `${LOGOUT_BLOCK}$1</aside>`);
  }

  out = out.replace(
    /<main class="flex-1 flex flex-col h-screen overflow-y-auto">/g,
    '<main class="portal-main flex-1 flex flex-col min-h-0 overflow-y-auto">'
  );
  out = out.replace(
    /<div class="flex-1 flex flex-col h-screen overflow-hidden">/,
    '<div class="portal-main flex-1 flex flex-col min-h-0 overflow-hidden">'
  );

  out = out.replace(
    /class="bg-white border-b border-slate-200 px-8 py-5 flex items-center justify-between sticky top-0 z-10"/g,
    'class="portal-header bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 shrink-0"'
  );
  out = out.replace(
    /class="bg-white border-b border-slate-200 px-8 py-5 shadow-sm z-20 flex justify-between items-center shrink-0"/,
    'class="portal-header bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 shadow-sm z-20 flex flex-wrap justify-between items-center gap-3 shrink-0"'
  );

  out = out.replace(
    /class="p-8 max-w-7xl mx-auto w-full flex-1"/g,
    'class="portal-content p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full flex-1"'
  );
  out = out.replace(
    /<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">\s*\n\s*<table/g,
    '<div class="portal-table-wrap bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">\n                <table'
  );

  out = out.replace(/class="text-2xl font-bold text-slate-900"/g, 'class="text-xl sm:text-2xl font-bold text-slate-900"');

  if (!out.includes("/assets/portal-layout.css")) {
    out = out.replace("</body>", `${PORTAL_ASSETS}\n</body>`);
  }

  return out;
}

function patchLogin(html) {
  if (!html.includes("Gracemark Academy — Sign In")) return html;
  let out = html;
  out = out.replace(
    '<body class="bg-slate-950 text-slate-100">',
    '<body class="login-page bg-slate-950 text-slate-100">'
  );
  if (!out.includes("/assets/portal-layout.css")) {
    out = out.replace(
      '<link rel="stylesheet" href="/assets/style.css" />',
      '<link rel="stylesheet" href="/assets/style.css" />\n  <link rel="stylesheet" href="/assets/portal-layout.css" />'
    );
  }
  out = out.replace(/\s+overflow: hidden;\s*\n\s*position: relative;/, "\n      position: relative;\n      overflow-x: hidden;\n      min-height: 100dvh;");
  return out;
}

function patchApprovals(html) {
  if (!html.includes("Result Approvals")) return html;
  return html
    .replace(/class="px-8 pt-6 space-y-4"/, 'class="portal-content px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 space-y-4"')
    .replace(
      /<div class="flex gap-4">/,
      '<div class="portal-header-actions flex flex-wrap gap-3 w-full sm:w-auto">'
    );
}

for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    const before = fs.readFileSync(file, "utf8");
    let after = patchPortal(before);
    after = patchLogin(after);
    after = patchApprovals(after);
    if (after !== before) {
      fs.writeFileSync(file, after, "utf8");
      console.log("patched", path.relative(repo, file));
    }
  }
}
