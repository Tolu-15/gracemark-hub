import React from "react";
import { createRoot } from "react-dom/client";
import ReportSheet from "@/components/results/ReportSheet";

const A4_W = 210;
const A4_H = 297;
const MARGIN = 8;
const CAPTURE_PX = 794; // A4 width at 96dpi

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function imagesLoaded(el: HTMLElement) {
  await Promise.all(
    Array.from(el.querySelectorAll("img")).map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = img.onerror = () => r(); })
    )
  );
}

/**
 * Renders every report to its own A4 PDF and bundles them in one zip, one file per
 * student named "<Student> - <label>.pdf". Runs entirely in the browser, one report at a
 * time so memory stays flat for large classes.
 */
export async function downloadReportsZip(
  reports: any[],
  opts: { label: string; zipName: string; onProgress?: (done: number, total: number) => void }
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }, { default: JSZip }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
    import("jszip"),
  ]);

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${CAPTURE_PX}px;pointer-events:none;`;
  document.body.appendChild(host);

  const zip = new JSZip();
  const used = new Map<string, number>();

  try {
    for (let i = 0; i < reports.length; i++) {
      const report = reports[i];
      const mount = document.createElement("div");
      mount.className = "pdf-capture";
      mount.style.cssText = `width:${CAPTURE_PX}px;background:#fff;padding:24px;box-sizing:border-box;`;
      host.appendChild(mount);

      const root = createRoot(mount);
      root.render(React.createElement(ReportSheet, { report }));
      await nextFrame();
      await nextFrame();
      await imagesLoaded(mount);

      const canvas = await html2canvas(mount, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });

      // Fit the capture onto a single A4 page.
      const maxW = A4_W - MARGIN * 2;
      const maxH = A4_H - MARGIN * 2;
      let w = maxW;
      let h = (canvas.height * w) / canvas.width;
      if (h > maxH) {
        h = maxH;
        w = (canvas.width * h) / canvas.height;
      }
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (A4_W - w) / 2, MARGIN, w, h, undefined, "FAST");

      const base = safeName(`${report.student?.name || "Student"} - ${opts.label}`);
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      const fileName = n === 1 ? `${base}.pdf` : `${base} (${report.student?.admissionNo || n}).pdf`;
      zip.file(fileName, pdf.output("arraybuffer"));

      root.unmount();
      host.removeChild(mount);
      opts.onProgress?.(i + 1, reports.length);
      await new Promise((r) => setTimeout(r, 0)); // let the progress bar paint
    }

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName(opts.zipName)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } finally {
    document.body.removeChild(host);
  }
}
