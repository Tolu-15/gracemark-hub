/**
 * Browsers name a "Save as PDF" file after document.title, so set a descriptive title
 * (e.g. "Ada Obi - JSS 1 - 1st Term 2025-2026 - Terminal Result") for the duration of the
 * print dialog, then restore it.
 */
export function printWithTitle(title: string) {
  const original = document.title;
  const clean = title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const restore = () => {
    document.title = original;
    window.removeEventListener("afterprint", restore);
  };
  document.title = clean || original;
  window.addEventListener("afterprint", restore);
  window.print();
  // Some browsers do not fire afterprint; make sure the title always comes back.
  setTimeout(restore, 60_000);
}
