import { startResultsEntry } from "/js/teacher/resultsEntry.js";

startResultsEntry().catch((e) => {
  console.error(e);
  alert(e?.message || "Failed to load gradebook.");
});

