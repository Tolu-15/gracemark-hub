"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { resolveStudentUserIdCandidates } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/schoolFinance";

export default function StudentPaymentHistoryPage() {
  const router = useRouter();
  const [payments, setPayments] = useState<any[]>([]);
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

        if (std) {
          const { data, error } = await supabase
            .from("payment_records")
            .select("*, payment_invoices(academic_session, term)")
            .eq("student_id", std.id)
            .order("payment_date", { ascending: false });

          if (error) throw error;
          setPayments(data || []);
        }
      } catch (err) {
        console.error("Payment history error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Payment History</h1>
          <p className="text-xs text-slate-500">Record of all school fee transactions and payments made.</p>
        </div>
        <Link
          href="/student/school-fees"
          className="px-4 py-2 bg-slate-900 text-white font-bold text-xs rounded-lg hover:bg-slate-800 transition-colors"
        >
          Pay Fees
        </Link>
      </header>

      <div className="p-6 max-w-5xl mx-auto w-full flex-1">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
                <tr>
                  <th className="px-5 py-3">Reference</th>
                  <th className="px-5 py-3">Session &amp; Term</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Channel</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-center">Status</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                      Loading payment records...
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                      No payment records found.
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3.5 font-mono font-medium text-slate-800">
                        {p.reference || p.transaction_reference || "—"}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {p.payment_invoices?.academic_session || "—"} • {p.payment_invoices?.term || "—"}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {formatDate(p.payment_date || p.created_at)}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 capitalize">
                        {p.payment_method || p.channel || "Card"}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(p.amount)}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                            ["success", "successful"].includes(String(p.status).toLowerCase())
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link
                          href={`/student/receipts?id=${p.id}`}
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                        >
                          Receipt →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
