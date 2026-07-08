import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import { ResultDashboardApp } from "./ResultDashboardApp.js";

let root = null;
let handlersAttached = false;
let escapeHandler = null;

export function openResultDashboard({ container, student, term, session, onClose }) {
  if (!container) return;

  container.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  if (!root) {
    root = createRoot(container);
  }

  const handleClose = () => {
    closeResultDashboard(container);
    onClose?.();
  };

  if (!handlersAttached) {
    container.addEventListener("click", (e) => {
      if (e.target === container) handleClose();
    });

    escapeHandler = (e) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", escapeHandler);
    handlersAttached = true;
  }

  root.render(
    React.createElement(ResultDashboardApp, {
      student,
      initialTerm: term,
      initialSession: session,
      onClose: handleClose,
    })
  );
}

export function closeResultDashboard(container) {
  if (root) {
    root.render(null);
  }
  container?.classList.add("hidden");
  document.body.style.overflow = "";
}
