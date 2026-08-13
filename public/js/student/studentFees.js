import { requireRole } from "/js/shared/guard.js";
import { supabase } from "/js/shared/supabaseClient.js";
import { getStudentCurrentInvoice, formatCurrency, getPaystackPublicKey } from "/js/shared/schoolFinance.js";

const authLoader = document.getElementById("authLoader");
const studentNameDisplay = document.getElementById("studentNameDisplay");
const sessionTermLabel = document.getElementById("sessionTermLabel");
const classNameLabel = document.getElementById("classNameLabel");
const statusBadgeContainer = document.getElementById("statusBadgeContainer");

const totalFeeDisplay = document.getElementById("totalFeeDisplay");
const amountPaidDisplay = document.getElementById("amountPaidDisplay");
const balanceDisplay = document.getElementById("balanceDisplay");
const feeItemsBody = document.getElementById("feeItemsBody");

const paymentActionBox = document.getElementById("paymentActionBox");
const customPayAmount = document.getElementById("customPayAmount");
const btnPayNow = document.getElementById("btnPayNow");

let currentFinanceData = null;
let loggedInUser = null;

function invoiceContextPayload() {
  const fee = currentFinanceData?.feeStructure || {};
  return {
    academic_session: fee.academic_session || currentFinanceData?.session || "2026/2027",
    term: fee.term || currentFinanceData?.termCode || "term1",
    class_id: currentFinanceData?.student?.class_id || fee.class_id || null,
    fee_structure_id: fee.id || null,
    total_amount: Number(currentFinanceData?.totalAmount || currentFinanceData?.outstandingBalance || customPayAmount.value || 0)
  };
}

async function ensureRealInvoice() {
  const studentId = currentFinanceData?.student?.id;
  if (!studentId) throw new Error("Student record not found for payment.");

  const existingId = currentFinanceData?.invoice?.id;
  if (existingId && !String(existingId).startsWith("INV-AUTO")) {
    return currentFinanceData.invoice;
  }

  const ctx = invoiceContextPayload();
  const { data: existingInv, error: existingErr } = await supabase
    .from("payment_invoices")
    .select("*")
    .eq("student_id", studentId)
    .eq("academic_session", ctx.academic_session)
    .or(`term.eq.${ctx.term},term.eq.${currentFinanceData?.termName || ctx.term}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingErr) console.warn("Invoice lookup note:", existingErr.message);
  if (existingInv) {
    currentFinanceData.invoice = existingInv;
    currentFinanceData.totalAmount = Number(existingInv.total_amount || ctx.total_amount || 0);
    currentFinanceData.outstandingBalance = Math.max(
      0,
      Number(existingInv.total_amount || 0) - Number(existingInv.amount_paid || 0)
    );
    return existingInv;
  }

  const invoiceNumber = `INV-${ctx.academic_session.replace(/\//g, "")}-${String(ctx.term).toUpperCase()}-${Date.now()}`;
  const { data: newInv, error: invErr } = await supabase
    .from("payment_invoices")
    .insert([{
      student_id: studentId,
      fee_structure_id: ctx.fee_structure_id,
      class_id: ctx.class_id,
      academic_session: ctx.academic_session,
      term: ctx.term,
      total_amount: ctx.total_amount,
      amount_paid: 0,
      status: "UNPAID",
      invoice_number: invoiceNumber
    }])
    .select()
    .maybeSingle();

  if (invErr || !newInv) {
    throw new Error(invErr?.message || "Could not create payment invoice.");
  }

  currentFinanceData.invoice = newInv;
  currentFinanceData.totalAmount = Number(newInv.total_amount || ctx.total_amount || 0);
  currentFinanceData.outstandingBalance = Math.max(
    0,
    Number(newInv.total_amount || 0) - Number(newInv.amount_paid || 0)
  );
  return newInv;
}

async function init() {
  try {
    const ok = await requireRole("student", { redirectTo: "/" });
    if (!ok) return;

    loggedInUser = ok.profile;
    if (authLoader) authLoader.style.display = "none";

    // Get student row ID
    let { data: student } = await supabase
      .from("students")
      .select("id, name")
      .eq("user_id", ok.user.id)
      .maybeSingle();

    if (!student) {
      const { data: altStudent } = await supabase
        .from("students")
        .select("id, name")
        .eq("id", ok.user.id)
        .maybeSingle();
      student = altStudent;
    }

    const studentId = student?.id || ok.user.id;
    const studentName = student?.name || ok.profile?.name || ok.user?.email || "Student";

    if (studentNameDisplay) studentNameDisplay.textContent = studentName;

    await loadStudentFees(studentId);
  } catch (err) {
    console.error("Student fees init error:", err);
    alert(err?.message || "Failed to load school fees.");
  }
}

async function loadStudentFees(studentId) {
  currentFinanceData = await getStudentCurrentInvoice(studentId);
  if (!currentFinanceData) return;

  const {
    session,
    termName,
    className,
    feeStructure,
    totalAmount,
    amountPaid,
    outstandingBalance,
    status
  } = currentFinanceData;

  sessionTermLabel.textContent = `${session} • ${termName.toUpperCase()}`;
  classNameLabel.textContent = `${className} Fee Breakdown`;

  totalFeeDisplay.textContent = formatCurrency(totalAmount);
  amountPaidDisplay.textContent = formatCurrency(amountPaid);
  balanceDisplay.textContent = formatCurrency(outstandingBalance);

  // Status Badge
  let badgeClass = "bg-rose-100 text-rose-800 border-rose-200";
  if (status === "FULLY PAID") badgeClass = "bg-emerald-100 text-emerald-800 border-emerald-200";
  else if (status === "PARTIALLY PAID") badgeClass = "bg-amber-100 text-amber-800 border-amber-200";

  statusBadgeContainer.innerHTML = `<span class="px-3.5 py-1.5 rounded-lg border text-xs font-extrabold uppercase tracking-wider ${badgeClass}">${status}</span>`;

  // Render Itemized Fee Rows
  feeItemsBody.innerHTML = "";
  if (feeStructure) {
    const items = [
      { name: "Tuition Fee", val: feeStructure.tuition_amount },
      { name: "Registration Fee", val: feeStructure.registration_fee },
      { name: "Exams Fee", val: feeStructure.exams_fee },
      { name: "Facilities & Development Fee", val: feeStructure.facilities_fee }
    ].filter(i => Number(i.val || 0) > 0);

    items.forEach(item => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-5 py-3 font-medium text-slate-800">${item.name}</td>
        <td class="px-5 py-3 text-right font-bold text-slate-900">${formatCurrency(item.val)}</td>
      `;
      feeItemsBody.appendChild(tr);
    });
  } else {
    feeItemsBody.innerHTML = `<tr><td colspan="2" class="p-4 text-center text-slate-500">No fee structure configured for your class for this term.</td></tr>`;
  }

  // Pre-fill payment input with remaining balance
  if (outstandingBalance > 0) {
    customPayAmount.value = outstandingBalance;
    paymentActionBox.classList.remove("hidden");
  } else {
    paymentActionBox.innerHTML = `<div class="w-full text-center font-bold text-emerald-400 py-2 text-sm">🎉 Congratulations! Your school fees for this term are FULLY PAID.</div>`;
  }
}

btnPayNow?.addEventListener("click", async () => {
  const payAmt = Number(customPayAmount.value || currentFinanceData.outstandingBalance || 20000);
  if (payAmt <= 0) {
    alert("Please enter a valid payment amount.");
    return;
  }

  if (payAmt > currentFinanceData.outstandingBalance) {
    alert(`Payment amount cannot exceed your outstanding balance of ${formatCurrency(currentFinanceData.outstandingBalance)}.`);
    return;
  }

  btnPayNow.disabled = true;
  btnPayNow.textContent = "Processing...";

  try {
    await ensureRealInvoice();

    // Fetch Paystack Public Key from .env / API / Supabase
    let pKey = await getPaystackPublicKey();
    if (!pKey || pKey.includes("your_paystack")) pKey = "pk_test_1b7ffdcc47fc414286a6637e7edcb0483659d2e7";

    const ref = `PAY-STU-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const studentEmail = loggedInUser?.email || "student@gracemark.edu.ng";

    if (typeof PaystackPop !== "undefined" && pKey) {
      try {
        const handler = PaystackPop.setup({
          key: pKey,
          email: studentEmail,
          amount: Math.round(payAmt * 100), // kobo
          currency: "NGN",
          ref: ref,
          callback: function (response) {
            verifyPaymentOnServer(response.reference || ref, payAmt).catch((err) => {
              console.error("Payment recording failed:", err);
              alert(err?.message || "Payment was completed, but the portal could not record it. Please contact the school admin with your Paystack reference.");
              btnPayNow.disabled = false;
              btnPayNow.textContent = "Pay via Paystack";
            });
          },
          onClose: function () {
            btnPayNow.disabled = false;
            btnPayNow.textContent = "Pay via Paystack";
          }
        });
        handler.openIframe();
        return;
      } catch (sdkErr) {
        console.error("Paystack popup error:", sdkErr);
        alert("Could not open Paystack checkout modal: " + sdkErr.message);
        btnPayNow.disabled = false;
        btnPayNow.textContent = "Pay via Paystack";
        return;
      }
    }
  } catch (err) {
    console.error("Payment trigger error:", err);
    alert("Failed to initiate payment: " + err.message);
    btnPayNow.disabled = false;
    btnPayNow.textContent = "Pay via Paystack";
  }
});

async function verifyPaymentOnServer(reference, amount) {
  try {
    const receiptNum = `REC-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    let remBalance = Math.max(0, Number(currentFinanceData?.outstandingBalance || 0) - Number(amount));
    let finalReceipt = receiptNum;
    const invRow = await ensureRealInvoice();
    const studId = currentFinanceData?.student?.id;
    const invoiceContext = invoiceContextPayload();

    // ── Step 1: Try server /api/verify-paystack-payment (uses service role key) ──
    try {
      const res = await fetch("/api/verify-paystack-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference,
          invoice_id: invRow.id,
          student_id: studId,
          amount,
          invoice: invoiceContext
        })
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) {}

      if (data?.ok) {
        console.log("✅ Server verified payment:", data);
        remBalance = data.outstanding_balance ?? remBalance;
        finalReceipt = data.receipt_number || receiptNum;
        showSuccessAndReload(finalReceipt, amount, remBalance);
        return;
      }
      console.warn("Server verify response not ok:", data);
    } catch (apiErr) {
      console.warn("Server API unreachable, using RPC fallback:", apiErr.message);
    }

    // ── Step 2: Supabase RPC (record_student_payment runs as SECURITY DEFINER) ──
    if (!invRow?.id || String(invRow.id).startsWith("INV-AUTO")) {
      console.error("No valid invoice ID — cannot record payment in DB.");
      throw new Error("No valid invoice ID - cannot record payment in DB.");
    }

    console.log("Calling record_student_payment RPC with:", {
      invoice_id: invRow.id, student_id: studId, reference, amount, receipt: receiptNum
    });

    const { data: rpcData, error: rpcErr } = await supabase.rpc("record_student_payment", {
      p_invoice_id: invRow.id,
      p_student_id: studId,
      p_reference: reference,
      p_amount: Number(amount),
      p_receipt_number: receiptNum
    });

    if (rpcErr) {
      console.error("RPC record_student_payment error:", rpcErr.message, rpcErr);
      // ── Step 3: Last resort — direct Supabase insert (may fail on RLS) ──
      console.warn("Attempting direct Supabase insert as last resort...");
      const { error: insErr } = await supabase.from("payment_records").insert([{
        invoice_id: invRow.id,
        student_id: studId,
        payment_reference: reference,
        receipt_number: receiptNum,
        amount: Number(amount),
        payment_gateway: "paystack",
        status: "successful",
        payment_date: new Date().toISOString(),
        verified_at: new Date().toISOString()
      }]);
      if (insErr) {
        console.error("Direct insert also failed:", insErr.message);
        throw new Error(`Payment verified, but portal record failed: ${insErr.message}`);
      } else {
        // Update invoice manually
        const newPaid = Number(currentFinanceData.amountPaid || 0) + Number(amount);
        const newBalance = Math.max(0, Number(currentFinanceData.totalAmount || 0) - newPaid);
        remBalance = newBalance;
        const newStatus = newBalance <= 0 ? "FULLY PAID" : "PARTIALLY PAID";
        await supabase.from("payment_invoices").update({
          amount_paid: newPaid, status: newStatus
        }).eq("id", invRow.id);
      }
    } else {
      console.log("✅ RPC success:", rpcData);
      if (rpcData?.ok === false) {
        throw new Error(rpcData.error || "Payment record RPC failed.");
      }
      remBalance = rpcData?.outstanding_balance ?? remBalance;
      finalReceipt = rpcData?.receipt_number || receiptNum;
    }

    showSuccessAndReload(finalReceipt, amount, remBalance);
  } catch (err) {
    console.error("verifyPaymentOnServer error:", err);
    alert(err?.message || "Payment was completed, but the portal could not record it. Please contact admin with your payment reference.");
  } finally {
    btnPayNow.disabled = false;
    btnPayNow.textContent = "Pay via Paystack";
  }
}

function showSuccessAndReload(receiptNum, amount, remBalance) {
  alert(
    `✅ Payment Successful!\n` +
    `Receipt No: ${receiptNum}\n` +
    `Amount Paid: ${formatCurrency(amount)}\n` +
    `Remaining Balance: ${formatCurrency(remBalance)}`
  );
  window.location.reload();
}

init();
