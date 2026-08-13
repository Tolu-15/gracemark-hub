const DISMISS_KEY = "gracemark_pwa_install_dismissed";
const DISMISS_DAYS = 14;
const SHOW_DELAY_MS = 2500;

let deferredPrompt = null;

function ensurePwaHead() {
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/manifest.webmanifest";
    document.head.appendChild(link);
  }

  if (!document.querySelector('meta[name="theme-color"]')) {
    const theme = document.createElement("meta");
    theme.name = "theme-color";
    theme.content = "#0f172a";
    document.head.appendChild(theme);
  }

  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const apple = document.createElement("link");
    apple.rel = "apple-touch-icon";
    apple.href = "/assets/icons/icon-192.png";
    document.head.appendChild(apple);
  }

  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const cap = document.createElement("meta");
    cap.name = "apple-mobile-web-app-capable";
    cap.content = "yes";
    document.head.appendChild(cap);
  }

  if (!document.querySelector('meta[name="mobile-web-app-capable"]')) {
    const cap2 = document.createElement("meta");
    cap2.name = "mobile-web-app-capable";
    cap2.content = "yes";
    document.head.appendChild(cap2);
  }

  if (!document.querySelector('meta[name="apple-mobile-web-app-title"]')) {
    const title = document.createElement("meta");
    title.name = "apple-mobile-web-app-title";
    title.content = "Gracemark";
    document.head.appendChild(title);
  }

  if (!document.querySelector('link[href="/assets/pwa-install.css"]')) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/assets/pwa-install.css";
    document.head.appendChild(css);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIosSafari() {
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isWebkit = /webkit/i.test(ua);
  const isChrome = /crios|chrome/i.test(ua);
  return isIos && isWebkit && !isChrome;
}

function wasDismissedRecently() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return false;
    return Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function dismissBanner() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  hideBanner();
}

function hideBanner() {
  const banner = document.getElementById("pwaInstallBanner");
  if (!banner) return;
  banner.classList.remove("is-visible");
  window.setTimeout(() => banner.remove(), 400);
}

function mountBanner({ iosHint = false } = {}) {
  if (document.getElementById("pwaInstallBanner") || isStandalone() || wasDismissedRecently()) {
    return;
  }

  const subtitle = iosHint
    ? "Tap Share, then “Add to Home Screen” for quick access."
    : "Open the portal from your home screen — fast access, full screen.";

  const banner = document.createElement("aside");
  banner.id = "pwaInstallBanner";
  banner.className = "pwa-install-banner";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Install Gracemark app");
  banner.innerHTML = `
    <div class="pwa-install-card" style="position:relative">
      <button type="button" class="pwa-install-close" aria-label="Dismiss">×</button>
      <img class="pwa-install-icon" src="/assets/icons/icon-192.png" width="44" height="44" alt="" />
      <div class="pwa-install-copy">
        <strong>Install Gracemark</strong>
        <span>${subtitle}</span>
      </div>
      <div class="pwa-install-actions">
        ${
          iosHint
            ? `<button type="button" class="pwa-install-btn pwa-install-btn--primary" id="pwaInstallGotIt">Got it</button>`
            : `<button type="button" class="pwa-install-btn pwa-install-btn--primary" id="pwaInstallBtn">Install</button>`
        }
        <button type="button" class="pwa-install-btn pwa-install-btn--ghost" id="pwaInstallLater">Not now</button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);

  banner.querySelector(".pwa-install-close")?.addEventListener("click", dismissBanner);
  banner.querySelector("#pwaInstallLater")?.addEventListener("click", dismissBanner);
  banner.querySelector("#pwaInstallGotIt")?.addEventListener("click", dismissBanner);
  banner.querySelector("#pwaInstallBtn")?.addEventListener("click", async () => {
    if (!deferredPrompt) {
      hideBanner();
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => ({ outcome: "dismissed" }));
    deferredPrompt = null;
    hideBanner();
  });

  requestAnimationFrame(() => {
    window.setTimeout(() => banner.classList.add("is-visible"), 50);
  });
}

function scheduleBanner() {
  if (isStandalone() || wasDismissedRecently()) return;
  window.setTimeout(() => {
    if (deferredPrompt) {
      mountBanner();
      return;
    }
    if (isIosSafari()) mountBanner({ iosHint: true });
  }, SHOW_DELAY_MS);
}

function initPwaInstall() {
  ensurePwaHead();
  registerServiceWorker();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    scheduleBanner();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideBanner();
  });
}

initPwaInstall();
