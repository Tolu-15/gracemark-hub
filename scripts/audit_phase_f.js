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

async function auditPhaseF() {
  console.log("=== AUDITING TERM, SESSION & PAYMENT DATA ===");

  // 1. Academic Sessions
  const { data: sessions } = await s.from("academic_sessions").select("id, name, status");
  console.log("\nAcademic Sessions:", sessions);

  // 2. Terms
  const { data: terms } = await s.from("terms").select("id, name, term, status, session");
  console.log("\nTerms table rows:", terms);

  // 3. Results terms and sessions
  const { data: results } = await s.from("results").select("term, session, status").limit(50);
  const resultTerms = new Set((results || []).map((r) => r.term));
  const resultSessions = new Set((results || []).map((r) => r.session));
  console.log("\nDistinct Results Terms:", Array.from(resultTerms));
  console.log("Distinct Results Sessions:", Array.from(resultSessions));

  // 4. Attendance terms and sessions
  const { data: att } = await s.from("attendance").select("term, session").limit(50);
  const attTerms = new Set((att || []).map((r) => r.term));
  const attSessions = new Set((att || []).map((r) => r.session));
  console.log("\nDistinct Attendance Terms:", Array.from(attTerms));
  console.log("Distinct Attendance Sessions:", Array.from(attSessions));

  // 5. Payment Invoices statuses, terms, sessions
  const { data: invoices } = await s.from("payment_invoices").select("status, term, session").limit(50);
  const invStatuses = new Set((invoices || []).map((r) => r.status));
  const invTerms = new Set((invoices || []).map((r) => r.term));
  const invSessions = new Set((invoices || []).map((r) => r.session));
  console.log("\nDistinct Invoice Statuses:", Array.from(invStatuses));
  console.log("Distinct Invoice Terms:", Array.from(invTerms));
  console.log("Distinct Invoice Sessions:", Array.from(invSessions));

  // 6. Payment Records statuses
  const { data: payRecords } = await s.from("payment_records").select("status").limit(50);
  const prStatuses = new Set((payRecords || []).map((r) => r.status));
  console.log("\nDistinct Payment Records Statuses:", Array.from(prStatuses));

  // 7. Student Enrollments sessions
  const { data: enrolls } = await s.from("student_enrollments").select("session").limit(50);
  const enrollSessions = new Set((enrolls || []).map((r) => r.session));
  console.log("\nDistinct Student Enrollments Sessions:", Array.from(enrollSessions));

  // 8. Student Subject Enrollments sessions
  const { data: sse } = await s.from("student_subject_enrollments").select("session").limit(50);
  const sseSessions = new Set((sse || []).map((r) => r.session));
  console.log("Distinct Student Subject Enrollments Sessions:", Array.from(sseSessions));
}

auditPhaseF().catch(console.error);
