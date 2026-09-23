const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
globalThis.WebSocket = require("ws");

const env = fs.readFileSync(".env.local", "utf8");
let url, key;
env.split("\n").forEach((l) => {
  if (l.startsWith("NEXT_PUBLIC_SUPABASE_URL=")) url = l.split("=")[1].trim();
  if (l.startsWith("SUPABASE_SERVICE_ROLE_KEY=")) key = l.split("=")[1].trim();
});

const supabase = createClient(url, key);

async function inspectDeprecated() {
  const candidateTables = [
    "_deprecated_assessments",
    "_deprecated_assessment_submissions",
    "_deprecated_assessment_questions",
    "_deprecated_assessment_answers",
    "_deprecated_assessment_grading_rules",
    "_deprecated_cbt_score_scaling",
    "_deprecated_cbt_attempt_history",
    "_deprecated_teacher_assignments",
    "teacher_assignments",
    "assessments",
    "assessment_submissions",
    "assessment_questions",
    "assessment_answers",
    "assessment_grading_rules",
    "cbt_score_scaling",
    "cbt_attempt_history",
    "cbt_exams",
    "cbt_questions",
    "cbt_submissions",
    "class_teacher_assignments",
    "subject_teacher_assignments",
    "student_enrollments",
    "student_subject_enrollments",
    "promotions",
    "alumni_students",
    "attendance",
    "attendance_records",
    "results"
  ];

  console.log("Checking candidate tables:");
  for (const t of candidateTables) {
    const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
    if (error) {
      console.log(`- ${t}: does not exist or inaccessible (${error.code})`);
    } else {
      console.log(`- ${t}: EXISTS with count = ${count}`);
    }
  }
}

inspectDeprecated().catch(console.error);
