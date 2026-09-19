"use client";

import React, { useEffect, useState } from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getStudentCurrentInvoice, formatCurrency, getPaystackPublicKey } from "@/lib/schoolFinance";

export default function StudentSchoolFeesPage() {
  const router = useRouter();
  const [student, setStudent] = useState<any>(null);
  const [userEmail, setUserEmail] = useState("");
  const [financeData, setFinanceData] = useState<any>(null);
  const [payAmount, setPayAmount] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paymentMsg, setPaymentMsg] = useState("");

  useEffect(() => {
    async function init() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.push("/");
          return;
        }

        setUserEmail(user.email || "student@gracemarkacademy.com");

        let { data: std } = await supabase
          .from("students")
          .select("id, name, admission_no, class_id, classes(name)")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!std) {
          const { data: altStd } = await supabase
            .from("students")
            .select("id, name, admission_no, class_id, classes(name)")
            .eq("id", user.id)
            .maybeSingle();
          std = altStd;
        }

        if (!std) throw new Error("Student profile not found.");

        setStudent(std);

        const fin = await getStudentCurrentInvoice(std.id);
        setFinanceData(fin);
        if (fin && fin.outstandingBalance > 0) {
          setPayAmount(fin.outstandingBalance);
        }
      } catch (err: any) {
        console.error("Fees init error:", err);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [router]);

  const handlePaystackPayment = async () => {
    const amount = Number(payAmount);
    if (!amount || amount < 100) {
      alert("Please enter a valid amount (minimum ₦100).");
      return;
    }

    setPaying(true);
    setPaymentMsg("Initiating secure payment gateway...");

    try {
      const publicKey = await getPaystackPublicKey();
      const reference = `GM-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

      if (typeof window === "undefined" || !(window as any).PaystackPop) {
        throw new Error("Paystack payment gateway is still loading. Please try again in 5 seconds.");
      }

      const handler = (window as any).PaystackPop.setup({
        key: publicKey,
        email: userEmail,
        amount: Math.round(amount * 100), // convert NGN to kobo
        currency: "NGN",
        ref: reference,
        metadata: {
          student_id: student.id,
          student_name: student.name,
          admission_no: student.admission_no,
          invoice_id: financeData?.invoice?.id,
          academic_session: financeData?.session,
          term: financeData?.termCode,
        },
        callback: async function (response: any) {
          setPaymentMsg("Payment received! Verifying transaction with bank...");
          try {
            const verifyRes = await fetch("/api/verify-paystack-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                reference: response.reference,
                studentId: student.id,
                invoiceId: financeData?.invoice?.id,
                amountPaid: amount,
              }),
            });

            const verifyData = await verifyRes.json();
            if (verifyData.success || verifyData.ok) {
              setPaymentMsg("Payment verified successfully! Updating financial record...");
              const updatedFin = await getStudentCurrentInvoice(student.id);
              setFinanceData(updatedFin);
              setPaymentMsg("Payment recorded! Outstanding balance updated.");
              setTimeout(() => setPaymentMsg(""), 5000);
            } else {
              setPaymentMsg(`Verification note: ${verifyData.message || "Payment logged."}`);
            }
          } catch (verErr: any) {
            console.error("Verification error:", verErr);
            setPaymentMsg("Payment recorded. Confirmation will reflect shortly.");
          } finally {
            setPaying(false);
          }
        },
        onClose: function () {
          setPaying(false);
          setPaymentMsg("Payment window closed.");
          setTimeout(() => setPaymentMsg(""), 3000);
        },
      });

      handler.openIframe();
    } catch (err: any) {
      console.error("Payment setup error:", err);
      alert(err.message || "Failed to launch Paystack.");
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-sm font-medium text-slate-500">Loading School Fees...</p>
      </div>
    );
  }

  const fee = financeData?.feeStructure || {};

  return (
    <>
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shrink-0">
          <div>
            <h1 className="text-xl font-bold text-slate-900">School Fees</h1>
            <p className="text-xs text-slate-500">View active term fee breakdown and complete online payment.</p>
          </div>
          <div className="text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg">
            {student?.name || "Student"}
          </div>
        </header>

        <div className="p-6 max-w-4xl mx-auto w-full space-y-6 flex-1">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div>
                <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
                  {financeData?.session ? `${financeData.session} • ` : ""}{financeData?.termName || "First Term"}
                </span>
                <h2 className="text-xl font-extrabold text-slate-900 mt-0.5">
                  {financeData?.className || "Class"} Fee Breakdown
                </h2>
              </div>
              <div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase ${
                    financeData?.status === "FULLY PAID"
                      ? "bg-emerald-100 text-emerald-800"
                      : financeData?.status === "PARTIALLY PAID"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-rose-100 text-rose-800"
                  }`}
                >
                  {financeData?.status || "UNPAID"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Total Expected Fee
                </span>
                <p className="text-2xl font-extrabold text-slate-900 mt-1">
                  {formatCurrency(financeData?.totalAmount)}
                </p>
              </div>
              <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-100">
                <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Amount Paid</span>
                <p className="text-2xl font-extrabold text-emerald-700 mt-1">
                  {formatCurrency(financeData?.amountPaid)}
                </p>
              </div>
              <div className="bg-rose-50/60 p-4 rounded-xl border border-rose-100">
                <span className="text-xs font-semibold text-rose-600 uppercase tracking-wider">
                  Outstanding Balance
                </span>
                <p className="text-2xl font-extrabold text-rose-700 mt-1">
                  {formatCurrency(financeData?.outstandingBalance)}
                </p>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
                  <tr>
                    <th className="px-5 py-3">Fee Item</th>
                    <th className="px-5 py-3 text-right">Amount (₦)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="px-5 py-3 font-medium text-slate-800">Tuition Fee</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold">
                      {formatCurrency(fee.tuition_amount || 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3 font-medium text-slate-800">Registration / Enrollment</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold">
                      {formatCurrency(fee.registration_fee || 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3 font-medium text-slate-800">Examinations &amp; Continuous Assessment</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold">
                      {formatCurrency(fee.exams_fee || 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3 font-medium text-slate-800">Facilities, Library &amp; ICT</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold">
                      {formatCurrency(fee.facilities_fee || 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {paymentMsg && (
              <div className="p-3 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-medium">
                {paymentMsg}
              </div>
            )}

            <div className="bg-slate-900 text-white rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-base">Make School Fee Payment</h3>
                <p className="text-xs text-slate-300">
                  You can pay the full outstanding balance or make partial installment payments.
                </p>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <input
                  type="number"
                  min="100"
                  step="500"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="Amount to pay"
                  className="px-3 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg text-xs w-36 outline-none focus:border-yellow-500"
                />
                <button
                  onClick={handlePaystackPayment}
                  disabled={paying || Number(payAmount) <= 0}
                  className="px-5 py-2.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-lg transition-colors shadow-md whitespace-nowrap"
                >
                  {paying ? "Processing..." : "Pay via Paystack"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
