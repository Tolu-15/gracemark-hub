"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { resolveStudentUserIdCandidates } from "@/lib/auth";
import { formatCurrency, formatDate, getStudentHistory } from "@/lib/schoolFinance";

export default function StudentReceiptsPage() {
  const searchParams = useSearchParams();
  const paymentId = searchParams.get("id");
  const router = useRouter();

  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.push("/");
          return;
        }

        const candidateIds = await resolveStudentUserIdCandidates(user.id);
        const { data: std } = await supabase
          .from("students")
          .select("id")
          .in("user_id", candidateIds)
          .maybeSingle();

        const { payments } = std ? await getStudentHistory(std.id) : { payments: [] as any[] };
        const data = (paymentId ? payments.find((p: any) => p.id === paymentId) : payments[0]) || null;

        setReceipt(data);
      } catch (err) {
        console.error("Receipt load error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [paymentId, router]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-sm font-medium text-slate-500">Generating Payment Receipt...</p>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="flex-1 p-8 max-w-lg mx-auto text-center">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <p className="text-sm text-slate-600">No verified payment receipt found.</p>
          <button
            onClick={() => router.push("/student/payment-history")}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold"
          >
            View Payment History
          </button>
        </div>
      </div>
    );
  }

  const inv = receipt.payment_invoices || {};
  const std = receipt.students || {};

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-slate-50 print:bg-white">
      {/* Controls Bar (hidden in print) */}
      <div className="no-print bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Official Payment Receipt</h1>
          <p className="text-xs text-slate-500">Verify and print your official school fee payment receipt.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print Receipt
          </button>
        </div>
      </div>

      {/* Printable Receipt Card */}
      <div className="p-4 sm:p-8 max-w-2xl mx-auto w-full flex-1">
        <div className="bg-white rounded-2xl border-2 border-slate-300 p-8 shadow-sm space-y-6 print:border-none print:shadow-none print:p-0">
          {/* Header */}
          <div className="text-center border-b-2 border-slate-900 pb-5">
            <div className="flex items-center justify-center gap-3 mb-2">
              <img src="/assets/icons/logo.jpg" alt="Logo" className="w-12 h-12 rounded-lg object-cover" />
              <div className="text-left">
                <h2 className="text-xl font-black uppercase text-slate-900 tracking-tight">Gracemark Academy</h2>
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">
                  Official Fee Payment Receipt
                </p>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Ilorin, Kwara State, Nigeria • Email: bursar@gracemarkacademy.com</p>
          </div>

          {/* Receipt Info Meta */}
          <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-400">Receipt / Transaction Ref</span>
              <span className="font-mono font-bold text-slate-900">{receipt.reference || receipt.id}</span>
            </div>
            <div className="text-right">
              <span className="block text-[10px] uppercase font-bold text-slate-400">Payment Date</span>
              <span className="font-bold text-slate-800">{formatDate(receipt.payment_date || receipt.created_at)}</span>
            </div>
          </div>

          {/* Student Info */}
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-400">Student Name</span>
              <span className="font-bold text-slate-900 text-sm">{std.name || "Student"}</span>
            </div>
            <div className="text-right">
              <span className="block text-[10px] uppercase font-bold text-slate-400">Admission Number</span>
              <span className="font-mono font-bold text-slate-800">{std.admission_no || "—"}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-400">Class</span>
              <span className="font-bold text-slate-800">{std.classes?.name || "Unassigned"}</span>
            </div>
            <div className="text-right">
              <span className="block text-[10px] uppercase font-bold text-slate-400">Academic Period</span>
              <span className="font-bold text-slate-800">{inv.academic_session || "—"} • {inv.term || "—"}</span>
            </div>
          </div>

          {/* Payment Summary */}
          <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200 font-bold uppercase text-slate-600">
                <tr>
                  <th className="p-3 text-left">Description</th>
                  <th className="p-3 text-right">Amount (₦)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="p-3 text-slate-800">
                    School Fee Installment / Full Payment
                    <span className="block text-[10px] text-slate-400 font-mono">Channel: {receipt.channel || "Paystack Card / Transfer"}</span>
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-slate-900 text-sm">
                    {formatCurrency(receipt.amount)}
                  </td>
                </tr>
                <tr className="bg-emerald-50/40 font-bold">
                  <td className="p-3 text-emerald-900">Total Amount Confirmed</td>
                  <td className="p-3 text-right text-emerald-900 text-base font-mono">
                    {formatCurrency(receipt.amount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Verification Badge & Stamp */}
          <div className="flex justify-between items-end border-t border-slate-100 pt-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold uppercase tracking-wider">
                ✓ VERIFIED &amp; CONFIRMED
              </div>
              <p className="text-[10px] text-slate-400 mt-2">Electronic receipt generated automatically.</p>
            </div>
            <div className="text-right">
              <div className="w-24 h-12 border-b-2 border-dashed border-slate-400 mb-1 ml-auto flex items-center justify-center text-slate-300 text-[10px]">
                OFFICIAL STAMP
              </div>
              <span className="text-[10px] font-bold text-slate-500 uppercase">Bursary Department</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
