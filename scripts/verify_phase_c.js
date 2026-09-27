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

async function verifyPhaseC() {
  console.log("=== VERIFYING PHASE C: ENROLLMENT UNIFICATION ===");

  // 1. Fetch active session
  const { data: session } = await supabase
    .from("academic_sessions")
    .select("id, name")
    .eq("status", "active")
    .single();

  console.log("Active Session:", session.name, `(${session.id})`);

  // 2. Fetch all active student enrollments
  const { data: enrollments, error: eErr } = await supabase
    .from("student_enrollments")
    .select("id, student_id, class_id, status, students(id, name, class_id)")
    .eq("academic_session_id", session.id)
    .eq("status", "active");

  if (eErr) {
    console.error("Error fetching enrollments:", eErr);
    process.exit(1);
  }

  console.log(`Found ${enrollments.length} active student class enrollments.`);

  // 3. Verify students.class_id matches student_enrollments.class_id (derived cache consistency)
  let mismatchCount = 0;
  for (const e of enrollments) {
    if (e.students?.class_id !== e.class_id) {
      console.warn(`Mismatch for student ${e.students?.name}: enrollment class_id=${e.class_id}, students.class_id=${e.students?.class_id}`);
      mismatchCount++;
    }
  }

  if (mismatchCount === 0) {
    console.log("SUCCESS: All active students.class_id match student_enrollments.class_id.");
  } else {
    console.error(`FAILURE: Found ${mismatchCount} class_id mismatches.`);
    process.exit(1);
  }

  // 4. Fetch all student_subject_enrollments for active session
  const { data: sseRows, error: sseErr } = await supabase
    .from("student_subject_enrollments")
    .select("id, student_id, subject_id, class_id, academic_session_id, status")
    .eq("academic_session_id", session.id)
    .eq("status", "enrolled");

  if (sseErr) {
    console.error("Error fetching subject enrollments:", sseErr);
    process.exit(1);
  }

  console.log(`Found ${sseRows.length} active student subject enrollments.`);

  // Verify uniqueness of (student_id, subject_id, academic_session_id)
  const uniqueKeyMap = new Map();
  let duplicates = 0;
  for (const row of sseRows) {
    const key = `${row.student_id}:${row.subject_id}:${row.academic_session_id}`;
    if (uniqueKeyMap.has(key)) {
      duplicates++;
    } else {
      uniqueKeyMap.set(key, true);
    }
  }

  if (duplicates === 0) {
    console.log(`SUCCESS: 0 duplicates across all ${sseRows.length} subject enrollment rows.`);
  } else {
    console.error(`FAILURE: Found ${duplicates} duplicate subject enrollments.`);
    process.exit(1);
  }

  // 5. Test direct score-entry roster query for JSS 1 Mathematics
  const { data: jss1 } = await supabase.from("classes").select("id, name").eq("name", "JSS 1").single();
  const { data: math } = await supabase.from("subjects").select("id, name").eq("name", "Mathematics").single();

  if (jss1 && math) {
    const { data: roster, error: rosterErr } = await supabase
      .from("student_subject_enrollments")
      .select("student_id, students(id, name, admission_no)")
      .eq("class_id", jss1.id)
      .eq("subject_id", math.id)
      .eq("academic_session_id", session.id)
      .eq("status", "enrolled");

    if (rosterErr) {
      console.error("Error querying subject roster:", rosterErr);
      process.exit(1);
    }

    console.log(`Direct Subject Roster for JSS 1 Mathematics: ${roster.length} students enrolled.`);
    if (roster.length === 6) {
      console.log("SUCCESS: Direct score-entry query returns exact roster without fallbacks.");
    } else {
      console.error(`FAILURE: Expected 6 students, got ${roster.length}`);
      process.exit(1);
    }
  }

  console.log("\n=== PHASE C VERIFICATION SUCCESS ===");
}

verifyPhaseC().catch(console.error);
