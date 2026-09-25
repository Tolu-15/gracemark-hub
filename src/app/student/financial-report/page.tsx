"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { resolveStudentUserIdCandidates } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/schoolFinance";

export default function StudentFinancialReportPage() {
  const router = useRouter();
  const [student, setStudent] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
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
          .select("id, name, admission_no, classes:class_id(name)")
          .in("user_id", candidateIds)
          .maybeSingle();

        if (std) {
          setStudent(std);

          const { data: invList, error } = await supabase
            .from("payment_invoices")
            .select("*, payment_records(*)")
            .eq("student_id", std.id)
            .order("created_at", { ascending: false });

          if (error) throw error;
          setInvoices(invList || []);
        }
      } catch (err) {
        console.error("Financial report load error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.amount_paid || 0), 0);
  const totalBalance = Math.max(0, totalInvoiced - totalPaid);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Student Financial Report</h1>
          <p className="text-xs text-slate-500">Comprehensive summary of all fee billings, receipts, and account balance.</p>
        </div>
        <Link
          href="/student/school-fees"
          className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-bold text-xs rounded-lg transition-colors shadow-sm"
        >
          Make Payment
        </Link>
      </header>

      <div className="p-6 max-w-5xl mx-auto w-full space-y-6 flex-1">
        {/* KPI Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Billed Fees</span>
            <p className="text-2xl font-black text-slate-900 mt-1">{formatCurrency(totalInvoiced)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Total Amount Paid</span>
            <p className="text-2xl font-black text-emerald-700 mt-1">{formatCurrency(totalPaid)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-rose-600 uppercase tracking-wider">Cumulative Balance</span>
            <p className="text-2xl font-black text-rose-700 mt-1">{formatCurrency(totalBalance)}</p>
          </div>
        </div>

        {/* Invoices Breakdown Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-bold text-sm text-slate-900">Session &amp; Term Fee Invoices</h3>
            <span className="text-xs text-slate-400">{invoices.length} invoices</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
                <tr>
                  <th className="px-5 py-3">Invoice No</th>
                  <th className="px-5 py-3">Session &amp; Term</th>
                  <th className="px-5 py-3 text-right">Total (₦)</th>
                  <th className="px-5 py-3 text-right">Paid (₦)</th>
                  <th className="px-5 py-3 text-right">Balance (₦)</th>
                  <th className="px-5 py-3 text-center">Status</th>
                  <th className="px-5 py-3 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                      Loading financial invoices...
                    </td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                      No invoices recorded on your account.
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => {
                    const bal = Math.max(0, Number(inv.total_amount || 0) - Number(inv.amount_paid || 0));
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3.5 font-mono font-medium text-slate-800">
                          {inv.invoice_number || inv.id.substring(0, 8)}
                        </td>
                        <td className="px-5 py-3.5 text-slate-700 font-semibold">
                          {inv.academic_session} • {inv.term}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono font-semibold text-slate-900">
                          {formatCurrency(inv.total_amount)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-emerald-700 font-semibold">
                          {formatCurrency(inv.amount_paid)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-rose-700 font-semibold">
                          {formatCurrency(bal)}
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                              bal <= 0
                                ? "bg-emerald-100 text-emerald-800"
                                : inv.amount_paid > 0
                                ? "bg-amber-100 text-amber-800"
                                : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {bal <= 0 ? "PAID" : inv.amount_paid > 0 ? "PARTIAL" : "UNPAID"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-slate-500">
                          {formatDate(inv.created_at)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
