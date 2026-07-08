import "/js/shared/pwaInstall.js";

/** Mounts a proper site footer: "Powered by T_dev" */
function mountPoweredBy() {
  if (document.getElementById("tdev-powered-by")) return;

  const footer = document.createElement("footer");
  footer.id = "tdev-powered-by";
  footer.className = "tdev-site-footer";
  footer.innerHTML = "<p>Powered by <strong>T_dev</strong></p>";

  // Admin approvals and similar: aside + inner flex column
  const appColumn = document.querySelector("body > .flex-1.flex.flex-col");
  if (appColumn) {
    appColumn.appendChild(footer);
    return;
  }

  // Score entry: body column with action toolbar footer already present
  const bodyActionFooter = document.querySelector("body.flex-col > footer");
  if (bodyActionFooter) {
    document.body.appendChild(footer);
    return;
  }

  // Sidebar + main portal pages (student, admin, teacher dashboards)
  const main = document.querySelector("main.portal-main, main.flex.flex-col");
  if (main) {
    main.classList.add("tdev-main-with-footer");
    main.appendChild(footer);
    return;
  }

  // Login pages: full-height centered main + footer at bottom
  const loginMain = document.querySelector("body > main.min-h-screen");
  if (loginMain) {
    document.body.classList.add("tdev-body-footer", "flex", "flex-col", "min-h-screen");
    loginMain.classList.remove("min-h-screen");
    loginMain.classList.add("flex-1");
    document.body.appendChild(footer);
    return;
  }

  // Centered loader / redirect pages (student.html, teacher.html, etc.)
  if (document.body.classList.contains("items-center")) {
    document.body.classList.add("tdev-body-footer", "flex", "flex-col", "min-h-screen");
    document.body.classList.remove("items-center", "justify-center");

    const wrapper = document.createElement("div");
    wrapper.className = "flex-1 flex items-center justify-center w-full p-6";
    while (document.body.firstChild) {
      const child = document.body.firstChild;
      if (child.tagName === "SCRIPT" || child.tagName === "LINK") break;
      wrapper.appendChild(child);
    }
    document.body.insertBefore(wrapper, document.body.firstChild);
    document.body.appendChild(footer);
    return;
  }

  // 404 and other simple pages
  document.body.classList.add("tdev-body-footer", "flex", "flex-col", "min-h-screen");
  document.body.appendChild(footer);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountPoweredBy);
} else {
  mountPoweredBy();
}
