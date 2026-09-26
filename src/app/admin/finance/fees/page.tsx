"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import { getAcademicSessions } from "@/lib/academicSessions";
import { ClassRecord } from "@/types/database";

interface FeeStructure {
  id: string;
  school_id?: string;
  class_id?: string;
  academic_session: string;
  term: string;
  tuition_amount: number;
  registration_fee: number;
  exam_fee: number;
  facilities_fee: number;
  total_amount: number;
  due_date?: string;
  status: "ACTIVE" | "INACTIVE";
  description?: string;
  classes?: { id: string; name: string } | null;
}

export default function AdminFinanceFeesPage() {
  const [fees, setFees] = useState<FeeStructure[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [sessionsList, setSessionsList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterSession, setFilterSession] = useState("");
  const [filterTerm, setFilterTerm] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [search, setSearch] = useState("");

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFee, setEditingFee] = useState<FeeStructure | null>(null);
  const [sessionIds, setSessionIds] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    academic_session: "",
    term: "term1",
    class_id: "",
    tuition_amount: 0,
    registration_fee: 0,
    exam_fee: 0,
    facilities_fee: 0,
    due_date: "",
    status: "ACTIVE" as "ACTIVE" | "INACTIVE",
    description: "",
  });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, { data: classesData }, { data: feesData, error: fErr }, dbSessions] = await Promise.all([
        getAppSettings(),
        supabase.from("classes").select("id, name").order("display_order"),
        supabase.from("fee_structures").select("*, classes(id, name), academic_sessions(id, name)").order("created_at", { ascending: false }),
        getAcademicSessions(),
      ]);

      const names = dbSessions.map((s) => s.name);
      setSessionsList(names);
      setSessionIds(Object.fromEntries(dbSessions.map((s) => [s.name, s.id])));

      const activeSession = settings?.current_session || (names.length > 0 ? names[0] : "");
      setFormData((prev) => ({ ...prev, academic_session: activeSession }));

      setClasses(classesData || []);
      if (fErr) throw fErr;
      setFees(
        ((feesData as any[]) || []).map((f) => {
          const sess = Array.isArray(f.academic_sessions) ? f.academic_sessions[0] : f.academic_sessions;
          return {
            ...f,
            academic_session: sess?.name || "",
            registration_fee: 0,
            exam_fee: Number(f.exam_levy || 0),
            facilities_fee: Number(f.development_levy || 0),
            status: "ACTIVE" as const,
          };
        })
      );
    } catch (err) {
      console.error("Failed to load fee structures:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleOpenModal(fee?: FeeStructure) {
    if (fee) {
      setEditingFee(fee);
      setFormData({
        academic_session: fee.academic_session,
        term: fee.term,
        class_id: fee.class_id || "",
        tuition_amount: fee.tuition_amount || 0,
        registration_fee: fee.registration_fee || 0,
        exam_fee: fee.exam_fee || 0,
        facilities_fee: fee.facilities_fee || 0,
        due_date: fee.due_date ? fee.due_date.slice(0, 10) : "",
        status: fee.status || "ACTIVE",
        description: fee.description || "",
      });
    } else {
      setEditingFee(null);
      setFormData({
        academic_session: sessionsList.length > 0 ? sessionsList[0] : "",
        term: "term1",
        class_id: classes.length ? classes[0].id : "",
        tuition_amount: 0,
        registration_fee: 0,
        exam_fee: 0,
        facilities_fee: 0,
        due_date: "",
        status: "ACTIVE",
        description: "",
      });
    }
    setIsModalOpen(true);
  }

  async function handleSaveFee(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const sessionId = sessionIds[formData.academic_session];
      if (!sessionId) throw new Error("Choose an academic session.");
      if (!formData.class_id) throw new Error("Choose the class this fee applies to.");

      const { data: { user } } = await supabase.auth.getUser();
      const { data: me } = await supabase.from("users").select("id").eq("auth_id", user?.id || "").maybeSingle();
      if (!me?.id) throw new Error("Could not identify your admin profile.");

      const cls = classes.find((c) => c.id === formData.class_id);
      const termLabel = formData.term === "term1" ? "First Term" : formData.term === "term2" ? "Second Term" : "Third Term";
      const payload: any = {
        academic_session_id: sessionId,
        term: formData.term,
        class_id: formData.class_id,
        title: `${cls?.name || "Class"} ${termLabel} Fees`,
        tuition_amount: Number(formData.tuition_amount || 0),
        development_levy: Number(formData.facilities_fee || 0),
        exam_levy: Number(formData.exam_fee || 0),
        due_date: formData.due_date || null,
      };

      if (editingFee) {
        const { error } = await supabase.from("fee_structures").update(payload).eq("id", editingFee.id);
        if (error) throw error;
      } else {
        payload.created_by = me.id;
        const { error } = await supabase.from("fee_structures").insert([payload]);
        if (error) {
          if ((error as any).code === "23505") throw new Error("A fee structure already exists for this class, session and term. Edit it instead.");
          throw error;
        }
      }

      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      alert("Error saving fee structure: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteFee(id: string) {
    if (!confirm("Are you sure you want to delete this fee structure? Existing invoices may be affected.")) return;
    try {
      const { error } = await supabase.from("fee_structures").delete().eq("id", id);
      if (error) throw error;
      loadData();
    } catch (err: any) {
      alert("Failed to delete: " + err.message);
    }
  }

  const filteredFees = fees.filter((f) => {
    if (filterSession && f.academic_session !== filterSession) return false;
    if (filterTerm && f.term !== filterTerm) return false;
    if (filterClass && f.class_id !== filterClass) return false;
    if (search) {
      const q = search.toLowerCase();
      const cName = f.classes?.name?.toLowerCase() || "all";
      const desc = f.description?.toLowerCase() || "";
      return cName.includes(q) || desc.includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Tuition &amp; Fee Structures</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Configure fee breakdowns, tuition rates, and deadlines by cohort and academic term.
          </p>
        </div>
        <button
          type="button"
          onClick={() => handleOpenModal()}
          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl transition shadow-xs flex items-center justify-center gap-2"
        >
          <span>+ Add Fee Structure</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by class or notes…"
          className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
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

      {/* Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="portal-table-wrap overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Class</th>
                <th className="py-3 px-4">Session / Term</th>
                <th className="py-3 px-4">Tuition</th>
                <th className="py-3 px-4">Exam Levy</th>
                <th className="py-3 px-4">Dev. Levy</th>
                <th className="py-3 px-4 font-bold text-slate-700">Total</th>
                <th className="py-3 px-4">Due Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    Loading fee structures…
                  </td>
                </tr>
              ) : filteredFees.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No fee structures found. Click &quot;+ Add Fee Structure&quot; to configure tuition.
                  </td>
                </tr>
              ) : (
                filteredFees.map((fee) => (
                  <tr key={fee.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      {fee.classes?.name || "All Classes"}
                    </td>
                    <td className="py-3.5 px-4">
                      {fee.academic_session} • {fee.term}
                    </td>
                    <td className="py-3.5 px-4">₦{Number(fee.tuition_amount || 0).toLocaleString()}</td>
                    <td className="py-3.5 px-4">
                      ₦{Number(fee.exam_fee || 0).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4">₦{Number(fee.facilities_fee || 0).toLocaleString()}</td>
                    <td className="py-3.5 px-4 font-bold text-emerald-600">
                      ₦{Number(fee.total_amount || 0).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500">
                      {fee.due_date ? new Date(fee.due_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(fee)}
                        className="text-indigo-600 hover:text-indigo-800 font-semibold"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFee(fee.id)}
                        className="text-rose-600 hover:text-rose-800 font-semibold"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900">
              {editingFee ? "Edit Fee Structure" : "Add New Fee Structure"}
            </h3>

            <form onSubmit={handleSaveFee} className="space-y-4 text-xs font-medium text-slate-700">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Session</label>
                  {sessionsList.length > 0 ? (
                    <select
                      required
                      value={formData.academic_session}
                      onChange={(e) => setFormData({ ...formData, academic_session: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                    >
                      <option value="">Select Session</option>
                      {sessionsList.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      placeholder="e.g. 2026/2027"
                      value={formData.academic_session}
                      onChange={(e) => setFormData({ ...formData, academic_session: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Term</label>
                  <select
                    value={formData.term}
                    onChange={(e) => setFormData({ ...formData, term: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                  >
                    <option value="term1">1st Term</option>
                    <option value="term2">2nd Term</option>
                    <option value="term3">3rd Term</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Class Cohort</label>
                <select
                  value={formData.class_id}
                  onChange={(e) => setFormData({ ...formData, class_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                >
                  <option value="">Select a class</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Tuition (₦)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.tuition_amount}
                    onChange={(e) => setFormData({ ...formData, tuition_amount: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Exam Levy (₦)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.exam_fee}
                    onChange={(e) => setFormData({ ...formData, exam_fee: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Development Levy (₦)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.facilities_fee}
                    onChange={(e) => setFormData({ ...formData, facilities_fee: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-100 rounded-xl flex items-center justify-between font-bold text-slate-800">
                <span>Calculated Total:</span>
                <span className="text-emerald-700 text-sm">
                  ₦
                  {(
                    Number(formData.tuition_amount || 0) +
                    Number(formData.exam_fee || 0) +
                    Number(formData.facilities_fee || 0)
                  ).toLocaleString()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Payment Deadline</label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none"
                  />
                </div>
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
                  {saving ? "Saving…" : "Save Structure"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
