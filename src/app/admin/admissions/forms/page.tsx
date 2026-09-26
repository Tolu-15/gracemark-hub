"use client";

import React, { useState, useEffect } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/schoolFinance";
import { getAppSettings } from "@/lib/appSettings";
import { getAcademicSessions } from "@/lib/academicSessions";

interface AdmissionFormPackage {
  id: string;
  name: string;
  academic_session: string;
  amount: number;
  status: "active" | "inactive";
  description?: string | null;
  created_at: string;
}

export default function AdminAdmissionsFormsPage() {
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<AdmissionFormPackage[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formSession, setFormSession] = useState("");
  const [formAmount, setFormAmount] = useState(10000);
  const [formStatus, setFormStatus] = useState("active");
  const [formDesc, setFormDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [settings, dbSessions] = await Promise.all([
        getAppSettings(),
        getAcademicSessions(),
      ]);

      const names = dbSessions.map((s) => s.name);
      setSessions(names);

      const currentSession = settings?.current_session || (names.length > 0 ? names[0] : "");
      setFormSession(currentSession);

      const { data, error } = await supabase
        .from("admission_forms")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setForms((data as any) || []);
    } catch (err: any) {
      console.error("Error loading admission forms:", err);
      alert("Failed to load admission forms: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openAddModal = () => {
    setEditId(null);
    setFormName("");
    setFormAmount(10000);
    setFormStatus("active");
    setFormDesc("");
    setIsModalOpen(true);
  };

  const openEditModal = (f: AdmissionFormPackage) => {
    setEditId(f.id);
    setFormName(f.name);
    setFormSession(f.academic_session);
    setFormAmount(f.amount);
    setFormStatus(f.status || "active");
    setFormDesc(f.description || "");
    setIsModalOpen(true);
  };

  const handleToggleStatus = async (f: AdmissionFormPackage) => {
    const nextStatus = f.status === "active" ? "inactive" : "active";
    try {
      const { error } = await supabase
        .from("admission_forms")
        .update({ status: nextStatus })
        .eq("id", f.id);
      if (error) throw error;
      await loadData();
    } catch (err: any) {
      alert("Failed to toggle status: " + err.message);
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert("Please enter a form name.");
      return;
    }

    setSaving(true);
    const payload = {
      name: formName.trim(),
      academic_session: formSession,
      amount: Number(formAmount) || 0,
      status: formStatus,
      description: formDesc.trim() || null,
    };

    try {
      if (editId) {
        const { error } = await supabase
          .from("admission_forms")
          .update(payload)
          .eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("admission_forms").insert([payload]);
        if (error) throw error;
      }

      setIsModalOpen(false);
      await loadData();
    } catch (err: any) {
      alert("Failed to save admission form: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shrink-0">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Admission Form Management</h1>
            <p className="text-xs text-slate-500">
              Configure online admission application forms and application fee amounts.
            </p>
          </div>
          <button
            onClick={openAddModal}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
          >
            + Create Admission Form
          </button>
        </header>

        <div className="p-6 max-w-7xl mx-auto w-full space-y-6 flex-1 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-5 py-3.5">Form Name</th>
                    <th className="px-5 py-3.5">Session</th>
                    <th className="px-5 py-3.5 text-right">Application Fee (₦)</th>
                    <th className="px-5 py-3.5 text-center">Status</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500">
                        Loading admission forms...
                      </td>
                    </tr>
                  ) : forms.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500">
                        No admission form packages created yet. Click &quot;+ Create Admission Form&quot; to create one.
                      </td>
                    </tr>
                  ) : (
                    forms.map((f) => {
                      const isAct = f.status === "active";
                      return (
                        <tr key={f.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-5 py-3.5">
                            <span className="font-bold text-slate-900 block">{f.name}</span>
                            <span className="text-[11px] text-slate-400">
                              {f.description || "No description"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 font-medium text-slate-700">
                            {f.academic_session}
                          </td>
                          <td className="px-5 py-3.5 text-right font-extrabold text-slate-900">
                            {formatCurrency(f.amount)}
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <span
                              className={`px-2.5 py-1 font-semibold rounded text-[11px] ${
                                isAct ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {isAct ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right space-x-2">
                            <button
                              onClick={() => openEditModal(f)}
                              className="text-blue-600 hover:text-blue-800 font-semibold text-xs"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleToggleStatus(f)}
                              className="text-slate-500 hover:text-slate-700 text-xs"
                            >
                              {isAct ? "Deactivate" : "Activate"}
                            </button>
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

        {/* Add/Edit Form Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 border border-slate-200 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <h3 className="font-bold text-base text-slate-900">
                  {editId ? "Edit Admission Form" : "Create Admission Form"}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 font-bold text-lg"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleSaveForm} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">
                    Form Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Entrance Admission Form"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs outline-none focus:border-slate-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      Academic Session *
                    </label>
                    {sessions.length > 0 ? (
                      <select
                        value={formSession}
                        onChange={(e) => setFormSession(e.target.value)}
                        required
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white outline-none"
                      >
                        <option value="">Select Session</option>
                        {sessions.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={formSession}
                        onChange={(e) => setFormSession(e.target.value)}
                        required
                        placeholder="e.g. 2026/2027"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white outline-none"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      Application Fee (₦) *
                    </label>
                    <input
                      type="number"
                      step="100"
                      min="0"
                      required
                      value={formAmount}
                      onChange={(e) => setFormAmount(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs outline-none focus:border-slate-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">
                    Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs outline-none focus:border-slate-500"
                    placeholder="e.g. Official Gracemark online entrance application form"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
                  >
                    {saving ? "Saving..." : "Save Form"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
