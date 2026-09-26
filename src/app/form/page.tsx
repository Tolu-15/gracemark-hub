"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Script from "next/script";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

declare const PaystackPop: any;

interface ClassItem {
  id: string;
  name: string;
}

interface CustomFormField {
  label: string;
  type: "text" | "number" | "textarea" | "select";
  required: boolean;
  options?: string[];
  placeholder?: string;
}

interface CustomFormRecord {
  id: string;
  title: string;
  description?: string | null;
  class_id?: string | null;
  fee_amount: number;
  form_fields: CustomFormField[];
  is_active: boolean;
}

function FormContent() {
  const searchParams = useSearchParams();
  const formId = searchParams.get("id");

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentForm, setCurrentForm] = useState<CustomFormRecord | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);

  // Form Fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");

  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianOccupation, setGuardianOccupation] = useState("");
  const [stateOfOrigin, setStateOfOrigin] = useState("");
  const [homeAddress, setHomeAddress] = useState("");

  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Submission saved on the server but not yet paid; lets the applicant retry payment without a duplicate.
  const [pendingSub, setPendingSub] = useState<null | {
    submission_id: string; reference: string | null; amount: number; email: string; public_key: string;
  }>(null);

  useEffect(() => {
    if (!formId) {
      setErrorMsg("No form ID provided in the URL.");
      setLoading(false);
      return;
    }

    const loadFormData = async () => {
      setLoading(true);
      try {
        const [cRes, fRes] = await Promise.all([
          supabase.from("classes").select("id, name").order("name"),
          supabase.from("custom_forms").select("*").eq("id", formId).eq("is_active", true).maybeSingle(),
        ]);

        setClasses(cRes.data || []);

        if (fRes.error || !fRes.data) {
          setErrorMsg("Form not found or has been deactivated by the admin.");
          return;
        }

        const formData = fRes.data as CustomFormRecord;
        setCurrentForm(formData);
        if (formData.class_id) {
          setSelectedClassId(formData.class_id);
        } else if (cRes.data && cRes.data.length > 0) {
          setSelectedClassId(cRes.data[0].id);
        }
      } catch (err: any) {
        console.error("Form load error:", err);
        setErrorMsg("Unable to load form data. Please check your internet connection.");
      } finally {
        setLoading(false);
      }
    };

    loadFormData();
  }, [formId]);

  const handleCustomChange = (key: string, val: string) => {
    setCustomAnswers((prev) => ({ ...prev, [key]: val }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (submitting) return;

    if (!name.trim() || !email.trim()) {
      setFormError("Please fill in your name and email.");
      return;
    }

    if (!selectedClassId) {
      setFormError("Please select a target admission class.");
      return;
    }

    // Validate required custom fields
    if (currentForm?.form_fields) {
      for (const f of currentForm.form_fields) {
        if (f.required && !customAnswers[f.label]?.trim()) {
          setFormError(`Please fill in required field: ${f.label}`);
          return;
        }
      }
    }

    setSubmitting(true);

    try {
      // 1. Save the submission on the server. The fee is read from the form record there; no account is created.
      let sub = pendingSub;
      if (!sub) {
        const res = await fetch("/api/forms/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            form_id: formId,
            name,
            email,
            form_data: {
              class_id: selectedClassId,
              gender,
              dob,
              guardian_name: guardianName,
              guardian_phone: guardianPhone,
              guardian_occupation: guardianOccupation,
              state_of_origin: stateOfOrigin,
              home_address: homeAddress,
              ...customAnswers,
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not save your submission.");
        sub = data;
        setPendingSub(data);
      }

      const current = sub!;
      if (!current.reference) {
        // Free form: nothing to pay.
        setDone("free");
        setSubmitting(false);
        return;
      }

      if (!current.public_key || typeof PaystackPop === "undefined") {
        setFormError("Online payment is unavailable right now. Please try again shortly or contact the school.");
        setSubmitting(false);
        return;
      }

      // 2. Take payment. Only the server confirming with Paystack marks it paid.
      const handler = PaystackPop.setup({
        key: current.public_key,
        email: current.email,
        amount: Math.round(current.amount * 100),
        currency: "NGN",
        ref: current.reference,
        metadata: { submission_id: current.submission_id, form_id: formId },
        callback: (response: any) => {
          (async () => {
            try {
              const res = await fetch("/api/forms/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reference: response.reference }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Payment could not be confirmed.");
              setPendingSub(null);
              setDone(response.reference);
            } catch (err: any) {
              setFormError(
                `We received your payment but could not confirm it yet (${err.message}). Keep your payment reference ${response.reference} and contact the school.`
              );
            } finally {
              setSubmitting(false);
            }
          })();
        },
        onClose: () => {
          setSubmitting(false);
          setFormError("Payment was not completed. Press Submit again to retry.");
        },
      });
      handler.openIframe();
    } catch (err: any) {
      setFormError(err.message || "An error occurred while submitting the form.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-8 h-8 border-4 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
        <p className="text-slate-400 text-sm mt-3">Fetching application details...</p>
      </div>
    );
  }

  if (errorMsg || !currentForm) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 bg-red-950/60 border border-red-800 text-red-400 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-red-300">Form Not Available</h3>
        <p className="text-xs text-slate-400 mt-1">{errorMsg || "This form link may be invalid or expired."}</p>
        <Link
          href="/"
          className="inline-block mt-5 px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition"
        >
          Back to Main Login
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 bg-emerald-950/60 border border-emerald-700 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-3 text-xl font-bold">
          ✓
        </div>
        <h3 className="text-lg font-bold text-emerald-300">Submission Received</h3>
        <p className="text-xs text-slate-400 mt-1">
          {done === "free" ? "Thank you. The school will be in touch." : `Payment confirmed. Reference: ${done}`}
        </p>
        <Link
          href="/"
          className="inline-block mt-5 px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  const fee = Number(currentForm.fee_amount || 0);

  return (
    <>
      <div className="text-center mb-8">
        <div className="w-14 h-14 mx-auto mb-3 bg-slate-900 border border-slate-700/60 rounded-2xl flex items-center justify-center shadow-lg">
          <svg className="w-7 h-7 text-amber-400" viewBox="0 0 30 30" fill="none">
            <path
              d="M15 3L4 8.5V15C4 20.25 8.88 25.17 15 27C21.12 25.17 26 20.25 26 15V8.5L15 3Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path
              d="M11 15.5l2.5 2.5L19 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-slate-100">{currentForm.title}</h1>
        <p className="text-sm text-slate-400 mt-1">{currentForm.description || "Gracemark Academy Portal"}</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-10 relative shadow-2xl space-y-6">
        <div className="h-[3px] bg-gradient-to-r from-amber-500 to-yellow-300 rounded-full mb-6" />

        {/* Fee Banner */}
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Application Fee</p>
              <p className="text-xs text-slate-300">
                {fee > 0 ? "Required payment via Paystack checkout" : "No application fee required for this form"}
              </p>
            </div>
          </div>
          <span className="text-lg font-bold text-amber-400">
            {fee > 0 ? `₦${fee.toLocaleString()}` : "FREE"}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Student Account Info */}
          <div>
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 pb-2 border-b border-slate-800">
              1. Student Account & Class Selection
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Samuel Adebayo"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value.toLowerCase())}
                  placeholder="e.g. samuel@example.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Select Admission Class *
                </label>
                <select
                  required
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-amber-300 font-semibold outline-none focus:border-amber-400"
                >
                  <option value="">-- Choose Target Class --</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Gender *
                </label>
                <select
                  required
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                >
                  <option value="">-- Select Gender --</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Parent / Guardian Details */}
          <div>
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 pb-2 border-b border-slate-800">
              2. Parent / Guardian Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Parent/Guardian Full Name
                </label>
                <input
                  type="text"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  placeholder="e.g. Mr. John Adebayo"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Parent Phone Number
                </label>
                <input
                  type="tel"
                  value={guardianPhone}
                  onChange={(e) => setGuardianPhone(e.target.value)}
                  placeholder="08012345678"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Occupation
                </label>
                <input
                  type="text"
                  value={guardianOccupation}
                  onChange={(e) => setGuardianOccupation(e.target.value)}
                  placeholder="e.g. Engineer, Business"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  State of Origin
                </label>
                <input
                  type="text"
                  value={stateOfOrigin}
                  onChange={(e) => setStateOfOrigin(e.target.value)}
                  placeholder="e.g. Oyo State"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Residential Home Address
                </label>
                <input
                  type="text"
                  value={homeAddress}
                  onChange={(e) => setHomeAddress(e.target.value)}
                  placeholder="Street name, City, State"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Custom Fields */}
          {currentForm.form_fields && currentForm.form_fields.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 pb-2 border-b border-slate-800">
                3. Additional Application Details
              </h3>
              <div className="space-y-4">
                {currentForm.form_fields.map((field, idx) => (
                  <div key={idx} className="flex flex-col gap-1">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      {field.label || `Field ${idx + 1}`} {field.required && "*"}
                    </label>

                    {field.type === "select" && field.options ? (
                      <select
                        required={field.required}
                        value={customAnswers[field.label] || ""}
                        onChange={(e) => handleCustomChange(field.label, e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                      >
                        <option value="">-- Select {field.label} --</option>
                        {field.options.map((opt, oIdx) => (
                          <option key={oIdx} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "textarea" ? (
                      <textarea
                        required={field.required}
                        rows={3}
                        value={customAnswers[field.label] || ""}
                        onChange={(e) => handleCustomChange(field.label, e.target.value)}
                        placeholder={field.placeholder || ""}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                      />
                    ) : (
                      <input
                        type={field.type || "text"}
                        required={field.required}
                        value={customAnswers[field.label] || ""}
                        onChange={(e) => handleCustomChange(field.label, e.target.value)}
                        placeholder={field.placeholder || ""}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-400"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {formError && (
            <div className="p-3 bg-red-950/80 border border-red-800/80 rounded-xl text-xs text-red-300 font-medium">
              {formError}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 text-center transition flex items-center justify-center gap-2 text-base cursor-pointer disabled:opacity-50"
          >
            {submitting ? (
              <span className="inline-block w-5 h-5 border-2 border-slate-950/40 border-t-slate-950 rounded-full animate-spin" />
            ) : (
              <span>
                {fee > 0
                  ? `Pay ₦${fee.toLocaleString()} & Complete Registration`
                  : "Submit & Register Account"}
              </span>
            )}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </form>
      </div>
    </>
  );
}

export default function PublicFormPage() {
  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 p-4 md:p-8 flex items-center justify-center relative">
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />
      <main className="w-full max-w-3xl">
        <Suspense
          fallback={
            <div className="text-center py-16 text-slate-400 text-sm">
              <div className="inline-block w-8 h-8 border-4 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mb-3" />
              <p>Loading application form...</p>
            </div>
          }
        >
          <FormContent />
        </Suspense>
      </main>
    </div>
  );
}
