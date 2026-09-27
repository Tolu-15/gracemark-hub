const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
globalThis.WebSocket = require("ws");

const env = fs.readFileSync(".env.local", "utf8");
let url, key;
env.split("\n").forEach((l) => {
  if (l.startsWith("NEXT_PUBLIC_SUPABASE_URL=")) url = l.split("=")[1].trim();
  if (l.startsWith("SUPABASE_SERVICE_ROLE_KEY=")) key = l.split("=")[1].trim();
});

const s = createClient(url, key);

async function run() {
  const { data: classes } = await s.from("classes").select("id, name");
  const { data: enrollments } = await s.from("student_enrollments").select("student_id, class_id, status");
  const { data: sse } = await s.from("student_subject_enrollments").select("student_id, subject_id, class_id, status");

  console.log("=== ENROLLMENT AUDIT BY CLASS ===");
  for (const c of classes) {
    const classEnrolls = (enrollments || []).filter((e) => e.class_id === c.id);
    const classSSE = (sse || []).filter((e) => e.class_id === c.id);
    if (classEnrolls.length > 0 || classSSE.length > 0) {
      console.log(`Class ${c.name} (${c.id}):`);
      console.log(`  - Active class enrollments: ${classEnrolls.length}`);
      console.log(`  - Active subject enrollments: ${classSSE.length}`);
      const studentsInSSE = new Set(classSSE.map((e) => e.student_id));
      const missingFromSSE = classEnrolls.filter((e) => !studentsInSSE.has(e.student_id));
      if (missingFromSSE.length > 0) {
        console.log(`  - WARNING: ${missingFromSSE.length} students have class enrollment but NO subject enrollments!`);
      } else {
        console.log(`  - All ${classEnrolls.length} students have subject enrollments.`);
      }
    }
  }
}
run().catch(console.error);
