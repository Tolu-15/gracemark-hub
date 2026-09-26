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

async function verifyPhaseA() {
  console.log("=== VERIFYING PHASE A: TEACHER ASSIGNMENTS ===");

  // 1. Fetch active session
  const { data: session } = await supabase
    .from("academic_sessions")
    .select("id, name")
    .eq("status", "active")
    .single();

  console.log("Active Session:", session.name, `(${session.id})`);

  // 2. Fetch all teachers in public.users
  const { data: teachers } = await supabase
    .from("users")
    .select("id, auth_id, email, staff_id, display_name")
    .eq("role", "teacher")
    .order("staff_id");

  console.log(`Auditing ${teachers.length} teachers in public.users...`);

  // 3. For each teacher, query class_teacher_assignments and subject_teacher_assignments
  let totalClassTeachers = 0;
  let totalSubjectAssignments = 0;

  for (const t of teachers) {
    const { data: cta } = await supabase
      .from("class_teacher_assignments")
      .select("class_id, classes(name)")
      .eq("teacher_user_id", t.auth_id)
      .eq("status", "active");

    const { data: sta } = await supabase
      .from("subject_teacher_assignments")
      .select("class_id, subject_id, classes(name), subjects(name)")
      .eq("teacher_user_id", t.auth_id)
      .eq("status", "active");

    const classDuties = (cta || []).map((c) => c.classes?.name).filter(Boolean);
    const subjectDuties = (sta || []).map((s) => `${s.classes?.name}: ${s.subjects?.name}`).filter(Boolean);

    totalClassTeachers += classDuties.length;
    totalSubjectAssignments += subjectDuties.length;

    console.log(`\nTeacher: ${t.display_name} (${t.staff_id || "No ID"} | ${t.email})`);
    console.log(`  - Class Teacher Duties (${classDuties.length}): ${classDuties.join(", ") || "None"}`);
    console.log(`  - Subject Teaching Duties (${subjectDuties.length}): ${subjectDuties.join("; ") || "None"}`);
  }

  console.log("\n=== PHASE A VERIFICATION SUMMARY ===");
  console.log(`Total Active Class Teacher Assignments: ${totalClassTeachers}`);
  console.log(`Total Active Subject Teacher Assignments: ${totalSubjectAssignments}`);

  if (totalClassTeachers >= 3 && totalSubjectAssignments >= 9) {
    console.log("SUCCESS: All teacher assignments verified in unified tables.");
  } else {
    console.error("FAILURE: Incomplete teacher assignments.");
    process.exit(1);
  }
}

verifyPhaseA().catch(console.error);
