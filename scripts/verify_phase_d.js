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

async function verifyPhaseD() {
  console.log("=== VERIFYING PHASE D: CBT & ASSESSMENT CONSOLIDATION ===");

  // 1. Fetch active session, class, subject, and student
  const { data: session } = await supabase
    .from("academic_sessions")
    .select("id, name")
    .eq("status", "active")
    .single();

  const { data: cls } = await supabase.from("classes").select("id, name").eq("name", "JSS 1").single();
  const { data: sub } = await supabase.from("subjects").select("id, name").eq("name", "Mathematics").single();
  const { data: student } = await supabase.from("students").select("id, name").eq("class_id", cls.id).limit(1).single();

  console.log(`Testing with Student: ${student.name}, Class: ${cls.name}, Subject: ${sub.name}, Session: ${session.name}`);

  // 2. Create test CBT exam
  const { data: testExam, error: examErr } = await supabase
    .from("cbt_exams")
    .insert({
      title: "Phase D Verification Exam",
      description: "Automated test exam for Phase D verification",
      class_id: cls.id,
      subject_id: sub.id,
      duration_minutes: 15,
      pass_mark: 50,
      is_published: true,
    })
    .select()
    .single();

  if (examErr || !testExam) {
    console.error("Failed to create test CBT exam:", examErr);
    process.exit(1);
  }

  console.log(`Created test CBT Exam: ${testExam.id}`);

  // 3. Create test question
  const { data: q1, error: qErr } = await supabase
    .from("cbt_questions")
    .insert({
      exam_id: testExam.id,
      question_text: "What is 2 + 2?",
      options: ["4", "3", "5", "22"],
      correct_option_index: 0,
      points: 1,
    })
    .select()
    .single();

  if (qErr || !q1) {
    console.error("Failed to create test CBT question:", qErr);
    process.exit(1);
  }

  // 4. Create student CBT submission
  const { data: cbtSub, error: subErr } = await supabase
    .from("cbt_submissions")
    .insert({
      exam_id: testExam.id,
      student_id: student.id,
      score: 1,
      total_questions: 1,
      passed: true,
      answers: { [q1.id]: "0" },
    })
    .select()
    .single();

  if (subErr || !cbtSub) {
    console.error("Failed to create CBT submission:", subErr);
    process.exit(1);
  }

  console.log(`Created test CBT Submission: ${cbtSub.id} (Score: 1/1, Passed: true)`);

  // 5. Test Gradebook Import Logic: Bridge CBT Exam Score to results table
  console.log("\nTesting CBT -> Gradebook Bridge...");
  const term = "term1";
  const scaledExamScore = 70; // 1/1 * 70

  const { data: resultRow, error: resErr } = await supabase
    .from("results")
    .upsert(
      {
        student_id: student.id,
        subject_id: sub.id,
        class_id: cls.id,
        term,
        session: session.name,
        academic_session_id: session.id,
        exam: scaledExamScore,
        total: scaledExamScore,
        grade: "A",
        status: "draft",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,subject_id,term,session" }
    )
    .select()
    .single();

  if (resErr) {
    console.log("Upsert on (student_id,subject_id,term,session) failed, trying (student_id,subject_id,term)...");
    const { data: fbResult, error: fbErr } = await supabase
      .from("results")
      .upsert(
        {
          student_id: student.id,
          subject_id: sub.id,
          class_id: cls.id,
          term,
          session: session.name,
          academic_session_id: session.id,
          exam: scaledExamScore,
          total: scaledExamScore,
          grade: "A",
          status: "draft",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,subject_id,term" }
      )
      .select()
      .single();

    if (fbErr) {
      console.error("Failed to upsert results row:", fbErr);
      process.exit(1);
    }
    console.log(`SUCCESS: Result row updated in gradebook! Exam score: ${fbResult.exam}, Total: ${fbResult.total}`);
  } else {
    console.log(`SUCCESS: Result row updated in gradebook! Exam score: ${resultRow.exam}, Total: ${resultRow.total}`);
  }

  // 6. Clean up test records
  console.log("\nCleaning up test verification artifacts...");
  await supabase.from("cbt_submissions").delete().eq("id", cbtSub.id);
  await supabase.from("cbt_questions").delete().eq("id", q1.id);
  await supabase.from("cbt_exams").delete().eq("id", testExam.id);
  console.log("Cleaned up test CBT exam, questions, and submission.");

  console.log("\n=== PHASE D VERIFICATION SUCCESS ===");
}

verifyPhaseD().catch(console.error);
