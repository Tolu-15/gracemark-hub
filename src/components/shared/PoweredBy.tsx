import React from "react";
import { TDEV_PORTFOLIO_URL } from "@/lib/branding";

export default function PoweredBy() {
  return (
    <footer id="tdev-powered-by" className="tdev-site-footer">
      <p>
        Powered by{" "}
        <a
          className="tdev-link"
          href={TDEV_PORTFOLIO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="T_dev portfolio (opens in a new tab)"
        >
          T_dev
        </a>
      </p>
    </footer>
  );
}
