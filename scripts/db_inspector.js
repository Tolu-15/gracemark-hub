const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
globalThis.WebSocket = require("ws");

// Read env
const env = fs.readFileSync(".env.local", "utf8");
let url, key;
env.split("\n").forEach((l) => {
  if (l.startsWith("NEXT_PUBLIC_SUPABASE_URL=")) url = l.split("=")[1].trim();
  if (l.startsWith("SUPABASE_SERVICE_ROLE_KEY=")) key = l.split("=")[1].trim();
});

if (!url || !key) {
  console.error("Missing SUPABASE env vars in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

async function inspectBaseline() {
  console.log("=== SUPABASE DATABASE BASELINE ROW COUNTS ===");
  const tables = [
    "users",
    "students",
    "classes",
    "subjects",
    "academic_sessions",
    "terms",
    "student_enrollments",
    "student_subject_enrollments",
    "teacher_assignments",
    "class_teacher_assignments",
    "subject_teacher_assignments",
    "attendance",
    "attendance_records",
    "results",
    "published_snapshots",
    "cbt_exams",
    "cbt_submissions",
    "assessments",
    "assessment_submissions",
    "payment_invoices",
    "payment_records",
    "fee_structures",
    "portal_access_settings"
  ];

  const results = {};
  for (const t of tables) {
    try {
      const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
      if (error) {
        results[t] = `ERROR: ${error.message}`;
        console.log(`${t.padEnd(32)}: ERROR (${error.message})`);
      } else {
        results[t] = count;
        console.log(`${t.padEnd(32)}: ${count} rows`);
      }
    } catch (err) {
      results[t] = `EXCEPTION: ${err.message}`;
      console.log(`${t.padEnd(32)}: EXCEPTION (${err.message})`);
    }
  }

  // Save baseline counts
  fs.writeFileSync("scripts/baseline_counts.json", JSON.stringify(results, null, 2));
  console.log("\nSaved baseline counts to scripts/baseline_counts.json");
}

inspectBaseline().catch(console.error);
