"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { ClassRecord } from "@/types/database";

interface StudentPaymentItem {
  id: string;
  name: string;
  admission_no: string;
  class_id?: string;
  className?: string;
  total_amount: number;
  amount_paid: number;
  balance: number;
  status: "FULLY PAID" | "PARTIALLY PAID" | "UNPAID";
}

export default function AdminPaymentStatusPage() {
  const [items, setItems] = useState<StudentPaymentItem[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterClass, setFilterClass] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [classesRes, studentsResCanonical, invoicesRes] = await Promise.all([
        supabase.from("classes").select("id, name").order("name"),
        supabase.from("students").select("id, full_name, admission_no, current_class_id, classes:current_class_id(name)").order("full_name"),
        supabase.from("payment_invoices").select("student_id, total_amount, amount_paid, status"),
      ]);

      let rawStudents: any[] = (studentsResCanonical.data as any[]) || [];
      if (studentsResCanonical.error) {
        const { data: legacyStds } = await supabase
          .from("students")
          .select("id, name, admission_no, class_id, classes:class_id(name)")
          .order("name");
        rawStudents = (legacyStds as any[]) || [];
      }

      setClasses(classesRes.data || []);

      const invMap = new Map<string, { total_amount: number; amount_paid: number; status: string }>();
      (invoicesRes.data || []).forEach((inv) => {
        if (inv.student_id) {
          invMap.set(inv.student_id, {
            total_amount: Number(inv.total_amount || 0),
            amount_paid: Number(inv.amount_paid || 0),
            status: inv.status || "UNPAID",
          });
        }
      });

      const list: StudentPaymentItem[] = (rawStudents || []).map((s: any) => {
        const inv = invMap.get(s.id);
        const total = inv?.total_amount || 0;
        const paid = inv?.amount_paid || 0;
        const balance = Math.max(0, total - paid);
        let status: "FULLY PAID" | "PARTIALLY PAID" | "UNPAID" = "UNPAID";
        if (balance === 0 && total > 0) status = "FULLY PAID";
        else if (paid > 0) status = "PARTIALLY PAID";

        return {
          id: s.id,
          name: s.full_name || s.name || "Student",
          admission_no: s.admission_no || "",
          class_id: s.current_class_id || s.class_id || "",
          className: s.classes?.name || "Unassigned",
          total_amount: total,
          amount_paid: paid,
          balance,
          status,
        };
      });

      setItems(list);
    } catch (err) {
      console.error("Payment status load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredItems = items.filter((item) => {
    if (filterClass && item.class_id !== filterClass) return false;
    if (filterStatus && item.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchAdm = item.admission_no.toLowerCase().includes(q);
      return matchName || matchAdm;
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          Student Fees & Payment Status
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Real-time tracking of tuition bills, amounts received, and balances per student cohort.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by student name or admission number…"
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
          />
        </div>

        <div className="w-48 shrink-0">
          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
          >
            <option value="">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="w-44 shrink-0">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
          >
            <option value="">All Payment Statuses</option>
            <option value="FULLY PAID">Fully Paid</option>
            <option value="PARTIALLY PAID">Partially Paid</option>
            <option value="UNPAID">Unpaid</option>
          </select>
        </div>
      </div>

      {/* Payment Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3.5">Student</th>
                <th className="px-4 py-3.5">Admission No</th>
                <th className="px-4 py-3.5">Class</th>
                <th className="px-4 py-3.5">Total Billed</th>
                <th className="px-4 py-3.5">Amount Paid</th>
                <th className="px-4 py-3.5">Outstanding Balance</th>
                <th className="px-6 py-3.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    Loading student fee statuses…
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    No records match your filter.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3.5 font-bold text-slate-900">
                      {item.name}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-600 font-medium">
                      {item.admission_no}
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-800">
                      {item.className}
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-900">
                      ₦{item.total_amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3.5 text-emerald-600 font-semibold">
                      ₦{item.amount_paid.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3.5 text-amber-600 font-semibold">
                      ₦{item.balance.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${item.status === "FULLY PAID"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : item.status === "PARTIALLY PAID"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-rose-50 text-rose-700 border-rose-200"
                          }`}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
