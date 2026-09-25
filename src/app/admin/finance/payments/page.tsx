"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import { getAcademicSessions } from "@/lib/academicSessions";
import { ClassRecord, StudentRecord } from "@/types/database";

interface PaymentRecordItem {
  id: string;
  payment_reference: string;
  receipt_number: string;
  amount: number;
  payment_gateway: string;
  status: string;
  payment_date: string;
  verified_at?: string;
  students?: {
    id: string;
    name: string;
    admission_no: string;
    classes?: { name: string } | null;
  } | null;
  payment_invoices?: {
    academic_session: string;
    term: string;
    class_id?: string;
  } | null;
}

export default function AdminFinancePaymentsPage() {
  const [payments, setPayments] = useState<PaymentRecordItem[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [sessionsList, setSessionsList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterSession, setFilterSession] = useState("");
  const [filterTerm, setFilterTerm] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [search, setSearch] = useState("");

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    student_id: "",
    amount: "",
    payment_gateway: "cash",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [
        { data: classesData },
        { data: studentsData },
        { data: recordsData, error: rErr },
        dbSessions,
      ] = await Promise.all([
        supabase.from("classes").select("id, name").order("name"),
        supabase.from("students").select("id, name, admission_no, class_id").order("name"),
        supabase
          .from("payment_records")
          .select("*, students(id, name, admission_no, classes:class_id(name)), payment_invoices(academic_session, term, class_id)")
          .order("payment_date", { ascending: false }),
        getAcademicSessions(),
      ]);

      setClasses(classesData || []);
      setStudents((studentsData as any[]) || []);
      setSessionsList(dbSessions.map((s) => s.name));
      if (rErr) throw rErr;
      setPayments((recordsData as any[]) || []);
    } catch (err) {
      console.error("Failed to load payment records:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.student_id || !formData.amount) {
      alert("Please select a student and enter an amount.");
      return;
    }

    setSaving(true);
    try {
      const amt = Number(formData.amount);
      const student = students.find((s) => s.id === formData.student_id);
      if (!student) throw new Error("Student not found.");

      // Find or create active invoice
      let { data: invoice } = await supabase
        .from("payment_invoices")
        .select("*")
        .eq("student_id", student.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!invoice) {
        const settings = await getAppSettings();
        const activeSession = settings?.current_session || (sessionsList[0] || "");
        const activeTerm = settings?.current_term || "term1";
        const invNumber = `INV-${Date.now()}`;
        const { data: newInv, error: invErr } = await supabase
          .from("payment_invoices")
          .insert([
            {
              student_id: student.id,
              class_id: student.class_id,
              total_amount: amt,
              amount_paid: 0,
              academic_session: activeSession,
              term: activeTerm,
              status: "UNPAID",
              invoice_number: invNumber,
            },
          ])
          .select()
          .single();

        if (invErr) throw invErr;
        invoice = newInv;
      }

      const year = new Date().getFullYear();
      const receiptNumber = `REC-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
      const paymentRef = `MANUAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const { error: recErr } = await supabase.from("payment_records").insert([
        {
          invoice_id: invoice.id,
          student_id: student.id,
          payment_reference: paymentRef,
          receipt_number: receiptNumber,
          amount: amt,
          payment_gateway: formData.payment_gateway,
          status: "successful",
          payment_date: new Date().toISOString(),
          verified_at: new Date().toISOString(),
          notes: formData.notes,
        },
      ]);
      if (recErr) throw recErr;

      // Update invoice
      const newPaid = Number(invoice.amount_paid || 0) + amt;
      const totalAmt = Number(invoice.total_amount || 0);
      const newStatus = newPaid >= totalAmt && totalAmt > 0 ? "FULLY PAID" : "PARTIALLY PAID";

      await supabase
        .from("payment_invoices")
        .update({ amount_paid: newPaid, status: newStatus })
        .eq("id", invoice.id);

      if (newStatus === "FULLY PAID") {
        await supabase
          .from("students")
          .update({ portal_access_status: "ACTIVE", portal_lock_reason: null })
          .eq("id", student.id);
      }

      setIsModalOpen(false);
      setFormData({ student_id: "", amount: "", payment_gateway: "cash", notes: "" });
      loadData();
    } catch (err: any) {
      alert("Error recording payment: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  const filteredPayments = payments.filter((p) => {
    if (filterSession && p.payment_invoices?.academic_session !== filterSession) return false;
    if (filterTerm && p.payment_invoices?.term !== filterTerm) return false;
    if (filterClass) {
      const cId = p.payment_invoices?.class_id;
      if (cId && cId !== filterClass) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const sName = p.students?.name?.toLowerCase() || "";
      const admNo = p.students?.admission_no?.toLowerCase() || "";
      const rec = p.receipt_number?.toLowerCase() || "";
      return sName.includes(q) || admNo.includes(q) || rec.includes(q);
    }
    return true;
  });

  const totalCollected = filteredPayments.reduce(
    (sum, p) => (p.status === "successful" || p.status === "success" ? sum + Number(p.amount || 0) : sum),
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Fee Payment Ledger</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Audit Paystack transactions, manual bank transfers, and verified student fee receipts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl transition shadow-xs"
          >
            + Record Manual Payment
          </button>
        </div>
      </div>

      {/* Filter Bar & Total Badge */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search student, admission #, receipt…"
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-none"
          />

          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-none"
          >
            <option value="">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={filterTerm}
            onChange={(e) => setFilterTerm(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-none"
          >
            <option value="">All Terms</option>
            <option value="term1">1st Term</option>
            <option value="term2">2nd Term</option>
            <option value="term3">3rd Term</option>
          </select>

          <select
            value={filterSession}
            onChange={(e) => setFilterSession(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-none"
          >
            <option value="">All Sessions</option>
            {sessionsList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs">
          <span className="text-emerald-700 font-medium">Filtered Total: </span>
          <span className="font-bold text-emerald-800">₦{totalCollected.toLocaleString()}</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="portal-table-wrap overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Receipt #</th>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Admission #</th>
                <th className="py-3 px-4">Class</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Gateway</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    Loading payment records…
                  </td>
                </tr>
              ) : filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No payment records found.
                  </td>
                </tr>
              ) : (
                filteredPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                      {p.receipt_number || "—"}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      {p.students?.name || "Student"}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-600">
                      {p.students?.admission_no || "—"}
                    </td>
                    <td className="py-3.5 px-4">
                      {p.students?.classes?.name || "—"}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-emerald-600">
                      ₦{Number(p.amount || 0).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 uppercase text-[11px] font-semibold text-slate-500">
                      {p.payment_gateway}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500">
                      {p.payment_date ? new Date(p.payment_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          p.status === "successful" || p.status === "success"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Payment Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Record Offline / Manual Payment</h3>

            <form onSubmit={handleRecordPayment} className="space-y-4 text-xs font-medium text-slate-700">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Select Student</label>
                <select
                  required
                  value={formData.student_id}
                  onChange={(e) => setFormData({ ...formData, student_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                >
                  <option value="">Choose student…</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.admission_no})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Amount Paid (₦)</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Payment Method</label>
                <select
                  value={formData.payment_gateway}
                  onChange={(e) => setFormData({ ...formData, payment_gateway: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                >
                  <option value="cash">Cash in School</option>
                  <option value="bank_transfer">Direct Bank Transfer</option>
                  <option value="pos">POS Terminal</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Notes / Teller #</label>
                <input
                  type="text"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Optional reference notes…"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition font-semibold"
                >
                  {saving ? "Recording…" : "Confirm Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
