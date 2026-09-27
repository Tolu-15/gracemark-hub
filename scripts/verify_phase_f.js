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

async function verifyPhaseF() {
  console.log("=== VERIFYING PHASE F: TERM, SESSION & PAYMENT NORMALIZATION ===");

  // 1. Verify Academic Sessions format
  const { data: sessions } = await supabase.from("academic_sessions").select("name");
  console.log(`Auditing ${sessions.length} academic sessions...`);
  const sessionRegex = /^\d{4}\/\d{4}$/;
  for (const s of sessions) {
    if (!sessionRegex.test(s.name)) {
      console.error(`FAILURE: Non-canonical academic session format: "${s.name}"`);
      process.exit(1);
    }
  }
  console.log("SUCCESS: All academic sessions follow canonical 'YYYY/YYYY' format.");

  // 2. Verify Terms table terms
  const { data: terms } = await supabase.from("terms").select("term");
  console.log(`Auditing ${terms.length} terms in terms table...`);
  const allowedTerms = new Set(["term1", "term2", "term3"]);
  for (const t of terms) {
    if (!allowedTerms.has(t.term)) {
      console.error(`FAILURE: Non-canonical term in terms table: "${t.term}"`);
      process.exit(1);
    }
  }
  console.log("SUCCESS: All terms follow canonical ('term1', 'term2', 'term3') format.");

  // 3. Test Payment Invoice Lifecycle with Canonical Statuses
  console.log("\nTesting Payment Invoice lifecycle with canonical lowercase statuses...");
  const { data: student } = await supabase.from("students").select("id, class_id").limit(1).single();

  const testInvNumber = `TEST-INV-${Date.now()}`;
  const { data: testInv, error: invErr } = await supabase
    .from("payment_invoices")
    .insert({
      student_id: student.id,
      class_id: student.class_id,
      academic_session: "2026/2027",
      term: "term1",
      total_amount: 50000,
      amount_paid: 0,
      status: "issued",
      invoice_number: testInvNumber,
    })
    .select()
    .single();

  if (invErr || !testInv) {
    console.error("Failed to insert test invoice:", invErr);
    process.exit(1);
  }
  console.log(`Created test invoice ${testInv.id} with status: ${testInv.status}`);

  // Transition to partially_paid
  const { data: partInv, error: partErr } = await supabase
    .from("payment_invoices")
    .update({ amount_paid: 20000, status: "partially_paid" })
    .eq("id", testInv.id)
    .select()
    .single();

  if (partErr || partInv.status !== "partially_paid") {
    console.error("Failed to update status to partially_paid:", partErr);
    process.exit(1);
  }
  console.log(`Transitioned to: ${partInv.status} (Paid: ${partInv.amount_paid})`);

  // Transition to paid
  const { data: paidInv, error: paidErr } = await supabase
    .from("payment_invoices")
    .update({ amount_paid: 50000, status: "paid" })
    .eq("id", testInv.id)
    .select()
    .single();

  if (paidErr || paidInv.status !== "paid") {
    console.error("Failed to update status to paid:", paidErr);
    process.exit(1);
  }
  console.log(`Transitioned to: ${paidInv.status} (Paid: ${paidInv.amount_paid})`);

  // Cleanup test invoice
  await supabase.from("payment_invoices").delete().eq("id", testInv.id);
  console.log("Cleaned up test invoice.");

  console.log("\n=== PHASE F VERIFICATION SUCCESS ===");
}

verifyPhaseF().catch(console.error);
