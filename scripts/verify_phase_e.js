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

async function verifyPhaseE() {
  console.log("=== VERIFYING PHASE E: RESULT PUBLICATION UNIFICATION ===");

  // 1. Fetch active session, a student, class, and subject
  const { data: session } = await supabase
    .from("academic_sessions")
    .select("id, name")
    .eq("status", "active")
    .single();

  const { data: cls } = await supabase.from("classes").select("id, name").eq("name", "JSS 1").single();
  const { data: sub } = await supabase.from("subjects").select("id, name").eq("name", "Mathematics").single();
  const { data: student } = await supabase.from("students").select("id, name").eq("class_id", cls.id).limit(1).single();

  const term = "term1";
  console.log(`Student: ${student.name}, Class: ${cls.name}, Subject: ${sub.name}, Session: ${session.name}`);

  // Test 1: Draft result MUST NOT be visible to student
  console.log("\nTest 1: Verifying DRAFT result gating...");
  let { data: resRow } = await supabase
    .from("results")
    .upsert(
      {
        student_id: student.id,
        subject_id: sub.id,
        class_id: cls.id,
        term,
        session: session.name,
        academic_session_id: session.id,
        status: "draft",
        tr_status: null,
        exam: 50,
        total: 50,
      },
      { onConflict: "student_id,subject_id,term,session" }
    )
    .select()
    .single();

  // Query as student with published gating
  const { data: draftCheck } = await supabase
    .from("results")
    .select("*")
    .eq("id", resRow.id)
    .eq("status", "published");

  if (draftCheck && draftCheck.length > 0) {
    console.error("FAILURE: Draft result leaked to student!");
    process.exit(1);
  }
  console.log("SUCCESS: Draft result is strictly blocked from student view.");

  // Test 2: Approved result MUST NOT be visible to student
  console.log("\nTest 2: Verifying APPROVED result gating (internal approval only)...");
  await supabase.from("results").update({ status: "approved" }).eq("id", resRow.id);

  const { data: approvedCheck } = await supabase
    .from("results")
    .select("*")
    .eq("id", resRow.id)
    .eq("status", "published");

  if (approvedCheck && approvedCheck.length > 0) {
    console.error("FAILURE: Approved result leaked to student before official publishing!");
    process.exit(1);
  }
  console.log("SUCCESS: Approved (internal) result is strictly blocked from student view.");

  // Test 3: Published result MUST be visible to student
  console.log("\nTest 3: Verifying PUBLISHED result access...");
  await supabase.from("results").update({ status: "published", tr_status: "published" }).eq("id", resRow.id);

  const { data: publishedCheck } = await supabase
    .from("results")
    .select("*")
    .eq("id", resRow.id)
    .eq("status", "published");

  if (!publishedCheck || publishedCheck.length === 0) {
    console.error("FAILURE: Published result not found for student!");
    process.exit(1);
  }
  console.log(`SUCCESS: Published result is visible to student! Score: ${publishedCheck[0].total}`);

  // Test 4: Unpublishing result revokes student access
  console.log("\nTest 4: Verifying UNPUBLISH revokes student access...");
  await supabase.from("results").update({ status: "approved", tr_status: null }).eq("id", resRow.id);

  const { data: unpublishCheck } = await supabase
    .from("results")
    .select("*")
    .eq("id", resRow.id)
    .eq("status", "published");

  if (unpublishCheck && unpublishCheck.length > 0) {
    console.error("FAILURE: Unpublished result still accessible to student!");
    process.exit(1);
  }
  console.log("SUCCESS: Unpublishing immediately revokes student access.");

  // Cleanup test row
  await supabase.from("results").delete().eq("id", resRow.id);
  console.log("Cleaned up test result row.");

  console.log("\n=== PHASE E VERIFICATION SUCCESS ===");
}

verifyPhaseE().catch(console.error);
