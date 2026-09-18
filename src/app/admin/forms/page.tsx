"use client";

import React, { useState, useEffect, useRef } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { supabase } from "@/lib/supabase/client";
import QRCode from "qrcode";

interface ClassOption {
  id: string;
  name: string;
}

interface CustomFormField {
  label: string;
  type: "text" | "number" | "textarea" | "select";
  required: boolean;
  options: string[];
}

interface CustomForm {
  id: string;
  title: string;
  description?: string | null;
  class_id?: string | null;
  fee_amount: number;
  form_fields: CustomFormField[];
  is_active: boolean;
  created_at: string;
  classes?: { name: string } | null;
  form_submissions?: { count: number }[];
}

export default function AdminFormsPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [forms, setForms] = useState<CustomForm[]>([]);
  const [loading, setLoading] = useState(true);

  // Create Form Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formClassId, setFormClassId] = useState("");
  const [formFee, setFormFee] = useState(5000);
  const [customFields, setCustomFields] = useState<CustomFormField[]>([]);
  const [savingForm, setSavingForm] = useState(false);

  // Share & QR Modal
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrModalTitle, setQrModalTitle] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadClasses = async () => {
    const { data } = await supabase.from("classes").select("id, name").order("name");
    const cls = data || [];
    setClasses(cls);
    if (cls.length > 0 && !formClassId) {
      setFormClassId(cls[0].id);
    }
  };

  const loadForms = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("custom_forms")
        .select("*, classes(name), form_submissions(count)")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setForms((data as any) || []);
    } catch (err: any) {
      console.error("Failed to load forms:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClasses();
    loadForms();
  }, []);

  const handleAddField = () => {
    setCustomFields((prev) => [
      ...prev,
      { label: "", type: "text", required: false, options: [] },
    ]);
  };

  const handleUpdateField = (index: number, key: keyof CustomFormField, value: any) => {
    setCustomFields((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [key]: value };
      return updated;
    });
  };

  const handleRemoveField = (index: number) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formClassId) {
      alert("Please fill in form title and select a class.");
      return;
    }

    setSavingForm(true);
    try {
      const { data, error } = await supabase
        .from("custom_forms")
        .insert([
          {
            title: formTitle.trim(),
            description: formDesc.trim() || null,
            class_id: formClassId,
            fee_amount: Number(formFee) || 0,
            form_fields: customFields,
            is_active: true,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      setIsCreateModalOpen(false);
      setFormTitle("");
      setFormDesc("");
      setFormFee(5000);
      setCustomFields([]);

      await loadForms();

      if (data) {
        const fullUrl = `${window.location.origin}/form?id=${data.id}`;
        openQrModal(data.title, fullUrl);
      }
    } catch (err: any) {
      alert("Failed to create form: " + err.message);
    } finally {
      setSavingForm(false);
    }
  };

  const handleDeleteForm = async (formId: string) => {
    if (!confirm("Are you sure you want to delete this form? Form submissions linked to it will be affected.")) {
      return;
    }
    try {
      const { error } = await supabase.from("custom_forms").delete().eq("id", formId);
      if (error) throw error;
      await loadForms();
    } catch (err: any) {
      alert("Failed to delete form: " + err.message);
    }
  };

  const openQrModal = async (title: string, url: string) => {
    setQrModalTitle(title);
    setQrUrl(url);
    setIsQrModalOpen(true);
    setCopied(false);

    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 240,
        margin: 2,
        color: {
          dark: "#020617",
          light: "#ffffff",
        },
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error("QR Code generation error:", err);
      setQrDataUrl(null);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(qrUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.download = `Gracemark-Form-QR-${Date.now()}.png`;
    link.href = qrDataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="portal-header bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Custom Admission Forms & QR Codes
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Create custom registration forms, attach Paystack fees, and generate shareable links & QR codes.
            </p>
          </div>
          <button
            onClick={() => {
              setCustomFields([]);
              setIsCreateModalOpen(true);
            }}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl shadow transition text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
            </svg>
            Create New Form
          </button>
        </header>

        <div className="p-6 max-w-7xl mx-auto w-full space-y-6 overflow-y-auto">
          {loading ? (
            <div className="text-center py-12 text-slate-400">
              <div className="w-6 h-6 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading forms...
            </div>
          ) : forms.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
              <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-slate-800">No Admission Forms Created Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Create custom registration forms for applicants, specify Paystack fees, and generate instant shareable links & downloadable QR codes.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {forms.map((form) => {
                const fee = Number(form.fee_amount || 0);
                const feeText = fee > 0 ? `₦${fee.toLocaleString()}` : "FREE";
                const submissionCount = form.form_submissions?.[0]?.count || 0;
                const fullUrl = typeof window !== "undefined" ? `${window.location.origin}/form?id=${form.id}` : "";

                return (
                  <div
                    key={form.id}
                    className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span
                          className={`px-2.5 py-1 text-[11px] font-bold uppercase rounded-full ${
                            fee > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          Fee: {feeText}
                        </span>
                        <span className="text-xs text-slate-400 font-semibold">
                          {new Date(form.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 leading-snug">{form.title}</h3>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {form.description || "No description provided."}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600">
                      <span>
                        Target: <strong className="text-slate-900">{form.classes?.name || "General"}</strong>
                      </span>
                      <span>
                        Submissions: <strong className="text-amber-600">{submissionCount}</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => openQrModal(form.title, fullUrl)}
                        className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
                      >
                        <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                          />
                        </svg>
                        Share & QR Code
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteForm(form.id)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition"
                        title="Delete Form"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create Form Modal */}
        {isCreateModalOpen && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-lg font-bold text-slate-900">Build New Registration Form</h3>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl font-bold"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleCreateForm} className="space-y-4 text-sm">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Form Title *</label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-amber-500"
                    placeholder="e.g. 2026/2027 JSS1 Entrance Admission"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Description / Guidelines</label>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-amber-500"
                    rows={2}
                    placeholder="Brief instructions for applicants..."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Target Class *</label>
                    <select
                      required
                      value={formClassId}
                      onChange={(e) => setFormClassId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-amber-500 bg-white"
                    >
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Paystack Fee Amount (₦)</label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={formFee}
                      onChange={(e) => setFormFee(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-amber-500"
                      placeholder="0 for Free"
                    />
                  </div>
                </div>

                {/* Custom Fields Section */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block font-bold text-slate-700">Custom Questions / Fields</label>
                    <button
                      type="button"
                      onClick={handleAddField}
                      className="text-xs text-amber-600 hover:text-amber-700 font-bold"
                    >
                      + Add Field
                    </button>
                  </div>
                  <div className="space-y-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    {customFields.length === 0 ? (
                      <p className="text-xs text-slate-400 italic text-center py-2">
                        No extra custom fields added yet.
                      </p>
                    ) : (
                      customFields.map((field, idx) => (
                        <div key={idx} className="p-2.5 bg-white border border-slate-200 rounded-lg flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={field.label}
                              onChange={(e) => handleUpdateField(idx, "label", e.target.value)}
                              placeholder="Field Label (e.g. Parent Phone)"
                              className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs outline-none focus:border-amber-500"
                            />
                            <select
                              value={field.type}
                              onChange={(e) => handleUpdateField(idx, "type", e.target.value)}
                              className="px-2 py-1.5 border border-slate-300 rounded text-xs outline-none focus:border-amber-500 bg-white"
                            >
                              <option value="text">Text Input</option>
                              <option value="number">Number</option>
                              <option value="textarea">Long Text</option>
                              <option value="select">Dropdown Options</option>
                            </select>
                            <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) => handleUpdateField(idx, "required", e.target.checked)}
                              />
                              Required
                            </label>
                            <button
                              type="button"
                              onClick={() => handleRemoveField(idx)}
                              className="text-red-500 hover:text-red-700 text-xs font-bold px-1"
                            >
                              &times;
                            </button>
                          </div>
                          {field.type === "select" && (
                            <input
                              type="text"
                              value={(field.options || []).join(", ")}
                              onChange={(e) =>
                                handleUpdateField(
                                  idx,
                                  "options",
                                  e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                                )
                              }
                              placeholder="Options separated by commas (e.g. Male, Female, Other)"
                              className="w-full px-2 py-1 border border-slate-200 rounded text-[11px] text-slate-600 outline-none"
                            />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="pt-3 flex justify-end gap-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingForm}
                    className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg shadow"
                  >
                    {savingForm ? "Saving..." : "Save & Generate Link/QR"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Share Link & QR Code Modal */}
        {isQrModalOpen && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl text-center space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-lg font-bold text-slate-900">{qrModalTitle}</h3>
                <button
                  type="button"
                  onClick={() => setIsQrModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl font-bold"
                >
                  &times;
                </button>
              </div>

              {/* QR Visual Canvas Container */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl inline-block shadow-inner mx-auto">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Form QR Code" className="w-48 h-48 mx-auto" />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-xs text-slate-400">
                    Generating QR code...
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-500">
                Scan this QR Code using any smartphone camera to open the application form directly.
              </p>

              {/* URL Input & Copy */}
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={qrUrl}
                  className="w-full px-3 py-2 text-xs bg-slate-100 border border-slate-300 rounded-lg text-slate-700 font-mono"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg shrink-0"
                >
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              </div>

              <div className="flex gap-3 justify-center pt-2">
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={qrUrl}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg"
                >
                  Preview Form
                </a>
                <button
                  type="button"
                  onClick={handleDownloadQr}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold rounded-lg shadow"
                >
                  Download QR Code PNG
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
