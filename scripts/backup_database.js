const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
globalThis.WebSocket = require("ws");

const env = fs.readFileSync(".env.local", "utf8");
let url, key;
env.split("\n").forEach((l) => {
  if (l.startsWith("NEXT_PUBLIC_SUPABASE_URL=")) url = l.split("=")[1].trim();
  if (l.startsWith("SUPABASE_SERVICE_ROLE_KEY=")) key = l.split("=")[1].trim();
});

const supabase = createClient(url, key);

async function fullBackup() {
  const backupDir = path.join(__dirname, "backup");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

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

  console.log("Starting full database snapshot backup into", backupDir);
  for (const t of tables) {
    try {
      const { data, error } = await supabase.from(t).select("*");
      if (error) {
        console.warn(`Could not export table ${t}:`, error.message);
      } else {
        const filePath = path.join(backupDir, `${t}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data || [], null, 2));
        console.log(`Backed up ${t} (${(data || []).length} rows)`);
      }
    } catch (err) {
      console.warn(`Exception exporting ${t}:`, err.message);
    }
  }
  console.log("Full pre-migration backup completed successfully.");
}

fullBackup().catch(console.error);
