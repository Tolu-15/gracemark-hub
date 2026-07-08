import { signOut } from "/js/shared/auth.js";

const HAMBURGER_SVG = `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>`;
const CLOSE_SVG = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`;

function getAppRoot() {
  return document.querySelector(".portal-app");
}

export function openPortalNav() {
  const root = getAppRoot();
  if (!root) return;
  root.classList.add("portal-nav-open");
  const btn = document.getElementById("portalMenuBtn");
  if (btn) btn.setAttribute("aria-expanded", "true");
  const backdrop = document.getElementById("portalNavBackdrop");
  if (backdrop) backdrop.hidden = false;
}

export function closePortalNav() {
  const root = getAppRoot();
  if (!root) return;
  root.classList.remove("portal-nav-open");
  const btn = document.getElementById("portalMenuBtn");
  if (btn) btn.setAttribute("aria-expanded", "false");
  const backdrop = document.getElementById("portalNavBackdrop");
  if (backdrop) backdrop.hidden = true;
}

function ensureBackdrop() {
  if (document.getElementById("portalNavBackdrop") || !getAppRoot()) return;
  const el = document.createElement("div");
  el.id = "portalNavBackdrop";
  el.className = "portal-nav-backdrop";
  el.hidden = true;
  el.addEventListener("click", closePortalNav);
  getAppRoot().insertBefore(el, getAppRoot().firstElementChild);
}

function ensureSidebarClose() {
  const sidebar = document.getElementById("portalSidebar");
  if (!sidebar || sidebar.querySelector("#portalMenuClose")) return;

  const brandRow = sidebar.querySelector(".portal-sidebar-brand");
  if (!brandRow) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "portalMenuClose";
  btn.className = "portal-sidebar-close";
  btn.setAttribute("aria-label", "Close navigation menu");
  btn.innerHTML = CLOSE_SVG;
  btn.addEventListener("click", closePortalNav);
  brandRow.appendChild(btn);
}

function ensureMenuButton() {
  const existing = document.getElementById("portalMenuBtn");
  if (existing) {
    if (existing.dataset.bound !== "1") {
      existing.dataset.bound = "1";
      existing.addEventListener("click", openPortalNav);
    }
    return;
  }

  const header = document.querySelector(".portal-header");
  if (!header) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "portalMenuBtn";
  btn.className = "portal-menu-btn";
  btn.setAttribute("aria-label", "Open navigation menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "portalSidebar");
  btn.innerHTML = HAMBURGER_SVG;
  btn.addEventListener("click", openPortalNav);
  header.prepend(btn);
}

function bindNavLinks() {
  const sidebar = document.getElementById("portalSidebar");
  if (!sidebar) return;
  sidebar.querySelectorAll("nav a[href]").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 767px)").matches) closePortalNav();
    });
  });
}

function bindLogout() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (!logoutBtn || logoutBtn.dataset.bound === "1") return;
  logoutBtn.dataset.bound = "1";
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut();
      window.location.replace("/");
    } catch (err) {
      console.error("Sign out failed:", err);
    }
  });
}

function bindKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePortalNav();
  });
  window.addEventListener(
    "resize",
    () => {
      if (window.matchMedia("(min-width: 768px)").matches) closePortalNav();
    },
    { passive: true }
  );
}

export function initPortalShell() {
  if (!getAppRoot()) return;
  ensureBackdrop();
  ensureMenuButton();
  ensureSidebarClose();
  bindNavLinks();
  bindLogout();
  bindKeys();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPortalShell);
} else {
  initPortalShell();
}
