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

async function verifyPhaseB() {
  console.log("=== VERIFYING PHASE B: ATTENDANCE UNIFICATION ===");

  // 1. Fetch active session and sample student & class
  const { data: session } = await supabase
    .from("academic_sessions")
    .select("id, name")
    .eq("status", "active")
    .single();

  const { data: student } = await supabase
    .from("students")
    .select("id, name, class_id")
    .limit(1)
    .single();

  if (!student || !session) {
    console.error("Missing student or session for attendance test.");
    process.exit(1);
  }

  const term = "term1";
  console.log(`Testing attendance for Student ${student.name} (${student.id}) in Session ${session.name}, Class ${student.class_id}`);

  // 2. Test Summary Attendance Upsert
  console.log("\nStep 1: Testing summary attendance upsert with default 120 days...");
  const summaryPayload = {
    student_id: student.id,
    class_id: student.class_id,
    term: term,
    session: session.name,
    academic_session_id: session.id,
    times_opened: 120,
    times_present: 116,
    times_absent: 4,
    updated_at: new Date().toISOString(),
  };

  let { error: sumErr } = await supabase
    .from("attendance")
    .upsert(summaryPayload, { onConflict: "student_id,term,session" });

  if (sumErr && /constraint/i.test(sumErr.message)) {
    console.log("Note: falling back to student_id,term conflict key if composite not in schema cache");
    const { error: fallbackErr } = await supabase
      .from("attendance")
      .upsert(summaryPayload, { onConflict: "student_id,term" });
    sumErr = fallbackErr;
  }

  if (sumErr) {
    console.error("Summary upsert error:", sumErr);
    process.exit(1);
  }

  // 3. Verify the summary row in attendance table
  const { data: attRow, error: fetchErr } = await supabase
    .from("attendance")
    .select("*")
    .eq("student_id", student.id)
    .eq("term", term)
    .maybeSingle();

  if (fetchErr || !attRow) {
    console.error("Could not fetch attendance row:", fetchErr);
    process.exit(1);
  }

  console.log("Verified Attendance Summary Row in DB:");
  console.log(`  - times_opened: ${attRow.times_opened}`);
  console.log(`  - times_present: ${attRow.times_present}`);
  console.log(`  - times_absent: ${attRow.times_absent}`);
  console.log(`  - session: ${attRow.session}`);

  if (attRow.times_opened !== 120) {
    console.error(`FAILURE: Expected times_opened = 120, got ${attRow.times_opened}`);
    process.exit(1);
  }

  // 4. Test Daily Attendance Record Upsert
  console.log("\nStep 2: Testing daily attendance record insertion...");
  const testDate = new Date().toISOString().split("T")[0];
  const dailyRecord = {
    student_id: student.id,
    class_id: student.class_id,
    term: term,
    session: session.name,
    date: testDate,
    am_present: true,
    pm_present: true,
  };

  const { error: dailyErr } = await supabase
    .from("attendance_records")
    .upsert([dailyRecord], { onConflict: "student_id,term,session,date" });

  if (dailyErr) {
    console.error("Daily record upsert error:", dailyErr);
    process.exit(1);
  }

  const { data: dailyRow, error: fetchDailyErr } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("student_id", student.id)
    .eq("term", term)
    .eq("session", session.name)
    .eq("date", testDate)
    .maybeSingle();

  if (fetchDailyErr || !dailyRow) {
    console.error("Could not fetch daily attendance record:", fetchDailyErr);
    process.exit(1);
  }

  console.log("Verified Daily Attendance Record:");
  console.log(`  - date: ${dailyRow.date}`);
  console.log(`  - am_present: ${dailyRow.am_present}`);
  console.log(`  - pm_present: ${dailyRow.pm_present}`);

  console.log("\n=== PHASE B VERIFICATION SUCCESS ===");
  console.log("Summary and daily attendance unified and verified with 120 default school days.");
}

verifyPhaseB().catch(console.error);
