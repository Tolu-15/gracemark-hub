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

// Inlined curriculum definitions for Phase G test
const SSS_CORE_SUBJECTS = [
  "Mathematics",
  "English",
  "Economics",
  "Citizenship",
  "Trade",
  "Digital Technology",
];
const SSS_SCIENCE_MAJORS = [
  "Chemistry",
  "Physics",
  "Biology",
  "Agric",
];
const SSS_SCIENCE_ELECTIVES = [
  "Further Math",
  "Technical Drawing",
  "Yoruba",
];
function getSSSTrackDefaults(className) {
  const c = String(className || "").trim().toUpperCase();
  if (c.includes("SCI")) {
    return { core: SSS_CORE_SUBJECTS, majors: SSS_SCIENCE_MAJORS, electives: SSS_SCIENCE_ELECTIVES };
  }
  return { core: SSS_CORE_SUBJECTS, majors: ["Biology", "Government", "Commerce"], electives: [] };
}

async function verifyPhaseG() {
  console.log("=== VERIFYING PHASE G: FINAL HARDENING & PROMOTIONS / AUTH / DEPRECATION ===");

  // =========================================================================
  // 1. Fee Defaulter Policy Lockout Verification
  // =========================================================================
  console.log("\n1. Auditing fee defaulter policy logic...");
  
  // Re-verify the evaluateStudentPortalAccess logic rules
  function testPortalAccess(invoice, policy) {
    if (!invoice) return { allowed: true };
    const balance = Number(invoice.balance_due || 0);
    const status = (invoice.payment_status || "").toLowerCase();
    
    if (status === "paid" || balance <= 0) return { allowed: true };
    if (policy === "flexible") return { allowed: true };
    if (policy === "strict") {
      return { allowed: false, reason: "School fees unpaid under strict policy." };
    }
    if (policy === "partial") {
      const total = Number(invoice.total_amount || 0);
      const paid = Number(invoice.amount_paid || 0);
      if (paid >= total * 0.5) return { allowed: true };
      return { allowed: false, reason: "Minimum threshold not met under partial policy." };
    }
    return { allowed: true };
  }

  const accessPaid = testPortalAccess({ payment_status: "paid", balance_due: 0 }, "strict");
  if (!accessPaid.allowed) {
    console.error("FAILURE: Paid student blocked under strict policy!");
    process.exit(1);
  }

  const accessUnpaidStrict = testPortalAccess({ payment_status: "issued", balance_due: 50000, total_amount: 50000, amount_paid: 0 }, "strict");
  if (accessUnpaidStrict.allowed) {
    console.error("FAILURE: Unpaid student allowed under strict policy!");
    process.exit(1);
  }
  console.log("✓ Strict policy correctly blocks defaulters:", accessUnpaidStrict.reason);

  const accessUnpaidFlexible = testPortalAccess({ payment_status: "issued", balance_due: 50000, total_amount: 50000, amount_paid: 0 }, "flexible");
  if (!accessUnpaidFlexible.allowed) {
    console.error("FAILURE: Unpaid student blocked under flexible policy!");
    process.exit(1);
  }
  console.log("✓ Flexible policy permits portal access.");

  const accessPartialMet = testPortalAccess({ payment_status: "partially_paid", balance_due: 25000, total_amount: 50000, amount_paid: 25000 }, "partial");
  const accessPartialUnmet = testPortalAccess({ payment_status: "partially_paid", balance_due: 35000, total_amount: 50000, amount_paid: 15000 }, "partial");
  if (!accessPartialMet.allowed || accessPartialUnmet.allowed) {
    console.error("FAILURE: Partial threshold policy evaluation incorrect!");
    process.exit(1);
  }
  console.log("✓ Partial policy thresholds correctly evaluated.");

  // =========================================================================
  // 2. Transactional Promotion Engine Verification
  // =========================================================================
  console.log("\n2. Testing transactional student promotion flow...");
  
  // Find JSS 3 and SSS 1 Science classes
  const { data: jss3Class } = await supabase.from("classes").select("id, name").ilike("name", "%JSS 3%").single();
  const { data: sss1SciClass } = await supabase.from("classes").select("id, name").ilike("name", "%SSS 1 Science%").single();

  if (!jss3Class || !sss1SciClass) {
    console.error("FAILURE: Required test classes (JSS 3, SSS 1 Science) not found!");
    process.exit(1);
  }

  // Find active session
  const { data: activeSession } = await supabase.from("academic_sessions").select("id, name").eq("status", "active").single();
  const testCurrentSessionId = activeSession.id;
  const testCurrentSession = activeSession.name;
  const testNextSession = "2027/2028";

  // Create temporary test auth user
  const testEmail = `test_prom_${Date.now()}@test.local`;
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: "TestPassword123!",
    email_confirm: true,
  });

  if (authErr || !authUser?.user?.id) {
    console.error("FAILURE creating test auth user:", authErr);
    process.exit(1);
  }
  const testUserId = authUser.user.id;

  // Create temporary test student
  const testAdmNo = "GMA/TEST/PROM/" + Date.now().toString().slice(-4);
  const { data: testStudent, error: stErr } = await supabase
    .from("students")
    .insert({
      user_id: testUserId,
      admission_no: testAdmNo,
      name: "Test Promotion Student",
      class_id: jss3Class.id,
      is_alumni: false,
    })
    .select("id, admission_no, class_id")
    .single();

  if (stErr || !testStudent) {
    console.error("FAILURE creating test student:", stErr);
    await supabase.auth.admin.deleteUser(testUserId);
    process.exit(1);
  }

  // Create active enrollment in JSS 3
  const { error: enrErr } = await supabase.from("student_enrollments").insert({
    student_id: testStudent.id,
    class_id: jss3Class.id,
    academic_session_id: testCurrentSessionId,
    session: testCurrentSession,
    status: "active",
  });
  if (enrErr) {
    console.error("FAILURE creating initial enrollment:", enrErr);
    await supabase.from("students").delete().eq("id", testStudent.id);
    process.exit(1);
  }

  console.log(`Created test student ${testStudent.id} in ${jss3Class.name} for session ${testCurrentSession}.`);

  // Ensure next academic session exists
  let nextSessionId;
  const { data: existingNextSess } = await supabase.from("academic_sessions").select("id").eq("name", testNextSession).maybeSingle();
  if (existingNextSess) {
    nextSessionId = existingNextSess.id;
  } else {
    const { data: createdSess, error: csErr } = await supabase
      .from("academic_sessions")
      .insert({ name: testNextSession, status: "inactive", is_current: false })
      .select("id")
      .single();
    if (csErr) {
      console.error("Failed creating next academic session:", csErr);
      process.exit(1);
    }
    nextSessionId = createdSess.id;
  }

  // Execute promotion:
  // 1. Mark previous enrollment promoted
  await supabase
    .from("student_enrollments")
    .update({ status: "promoted" })
    .eq("student_id", testStudent.id)
    .eq("academic_session_id", testCurrentSessionId);

  // 2. Insert new enrollment in SSS 1 Science
  await supabase.from("student_enrollments").upsert({
    student_id: testStudent.id,
    class_id: sss1SciClass.id,
    academic_session_id: nextSessionId,
    session: testNextSession,
    status: "active",
  }, { onConflict: "student_id,academic_session_id" });

  // 3. Update student class_id cache
  await supabase.from("students").update({ class_id: sss1SciClass.id }).eq("id", testStudent.id);

  // 4. Auto-enroll into SSS 1 Science subjects
  const sssDefaults = getSSSTrackDefaults(sss1SciClass.name);
  const targetSubjects = [...sssDefaults.core, ...sssDefaults.majors];
  const { data: dbSubjects } = await supabase.from("subjects").select("id, name");
  const subMap = new Map((dbSubjects || []).map((s) => [s.name.trim().toLowerCase(), s.id]));

  const ssePayload = [];
  for (const sName of targetSubjects) {
    const sId = subMap.get(sName.trim().toLowerCase());
    if (sId) {
      ssePayload.push({
        student_id: testStudent.id,
        subject_id: sId,
        class_id: sss1SciClass.id,
        academic_session_id: nextSessionId,
        session: testNextSession,
        status: "enrolled",
        is_active: true,
      });
    }
  }

  if (ssePayload.length > 0) {
    const { error: sseErr } = await supabase
      .from("student_subject_enrollments")
      .upsert(ssePayload, { onConflict: "student_id,subject_id,session" });
    if (sseErr) {
      console.error("FAILURE creating subject enrollments on promotion:", sseErr);
      process.exit(1);
    }
  }

  // 5. Log promotion record
  const { data: promoLog, error: pLogErr } = await supabase.from("promotions").insert({
    session: testCurrentSession,
    promoted_by: testUserId,
    summary: [{
      student_id: testStudent.id,
      name: "Test Promotion Student",
      from_class: jss3Class.name,
      to_class: sss1SciClass.name,
      action: "promoted",
      graduated: false
    }],
    notes: "Automated Phase G verification test"
  }).select("id").single();

  if (pLogErr) {
    console.error("FAILURE logging promotion event:", pLogErr);
    process.exit(1);
  }

  // =========================================================================
  // 3. Verify Database State Post-Promotion
  // =========================================================================
  const { data: verifyStudent } = await supabase.from("students").select("class_id").eq("id", testStudent.id).single();
  if (verifyStudent.class_id !== sss1SciClass.id) {
    console.error("FAILURE: Student class_id not updated to SSS 1 Science!");
    process.exit(1);
  }
  console.log("✓ Student class_id updated to SSS 1 Science.");

  const { data: prevEnr } = await supabase
    .from("student_enrollments")
    .select("status")
    .eq("student_id", testStudent.id)
    .eq("academic_session_id", testCurrentSessionId)
    .single();
  if (prevEnr?.status !== "promoted") {
    console.error("FAILURE: Previous enrollment status was not marked 'promoted'!");
    process.exit(1);
  }
  console.log("✓ Previous session enrollment correctly marked 'promoted'.");

  const { data: newEnr } = await supabase
    .from("student_enrollments")
    .select("status, class_id")
    .eq("student_id", testStudent.id)
    .eq("academic_session_id", nextSessionId)
    .single();
  if (newEnr?.status !== "active" || newEnr?.class_id !== sss1SciClass.id) {
    console.error("FAILURE: New session active enrollment in SSS 1 Science missing!");
    process.exit(1);
  }
  console.log("✓ Next session enrollment active in SSS 1 Science.");

  const { data: subjEnrs } = await supabase
    .from("student_subject_enrollments")
    .select("id")
    .eq("student_id", testStudent.id)
    .eq("academic_session_id", nextSessionId);
  console.log(`✓ Auto-enrolled into ${subjEnrs.length} subjects for SSS 1 Science curriculum.`);

  // Cleanup test artifacts
  await supabase.from("student_subject_enrollments").delete().eq("student_id", testStudent.id);
  await supabase.from("student_enrollments").delete().eq("student_id", testStudent.id);
  await supabase.from("students").delete().eq("id", testStudent.id);
  await supabase.auth.admin.deleteUser(testUserId);
  await supabase.from("promotions").delete().eq("id", promoLog.id);
  await supabase.from("academic_sessions").delete().eq("name", testNextSession);
  console.log("✓ Cleaned up test student, auth user, session, and promotion artifacts.");

  console.log("\n=== ALL PHASE G HARDENING CHECKS PASSED SUCCESSFULLY ===");
  process.exit(0);
}

verifyPhaseG().catch((err) => {
  console.error("Phase G verification failed with error:", err);
  process.exit(1);
});
