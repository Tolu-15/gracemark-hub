"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/supabase/client";
import { PageLoader } from "@/components/shared/PageLoader";

type Stage = "submitted" | "under_review" | "approved" | "enrolled" | "rejected" | "draft";

interface App {
  id: string;
  applicationNumber: string;
  status: Stage;
  surname: string;
  firstNames: string;
  gender: string | null;
  dateOfBirth: string | null;
  stateOfOrigin: string | null;
  homeAddress: string | null;
  passportUrl: string | null;
  previousSchool: string | null;
  previousClass: string | null;
  isBoarding: boolean | null;
  boardingType: string | null;
  medicalConditions: string | null;
  desiredClassId: string | null;
  desiredClass: string;
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
  parentOccupation: string | null;
  paid: { status: string; amount: number; paidAt: string | null } | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  studentId: string | null;
  studentAdmissionNo: string | null;
}

const TABS: { key: Stage; label: string; hint: string }[] = [
  { key: "submitted", label: "New", hint: "Paid, waiting for the school" },
  { key: "under_review", label: "In review", hint: "Being looked at" },
  { key: "approved", label: "Approved", hint: "Ready to enrol" },
  { key: "enrolled", label: "Enrolled", hint: "Now a student" },
  { key: "rejected", label: "Rejected", hint: "Not offered a place" },
  { key: "draft", label: "Unpaid", hint: "Started but the fee is not paid" },
];

const naira = (n: number) => `₦${Number(n || 0).toLocaleString("en-NG")}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(await getAuthHeaders()), ...(init?.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-sm text-slate-800 break-words">{value || "—"}</div>
    </div>
  );
}

export default function AdminApplicantsPage() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [tab, setTab] = useState<Stage>("submitted");
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [open, setOpen] = useState<App | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Action inputs for the open application
  const [reason, setReason] = useState("");
  const [admissionNo, setAdmissionNo] = useState("");
  const [enrolClass, setEnrolClass] = useState("");

  const load = useCallback(async () => {
    const { res, json } = await api("/api/admin/admissions");
    if (!res.ok || !json.ok) return setError(json.error || "Could not load applications.");
    setError(null);
    setApps(json.applications);
    setCounts(json.counts);
    setClasses(json.classes);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (apps || []).filter((a) => {
      if (a.status !== tab) return false;
      if (classFilter && a.desiredClassId !== classFilter) return false;
      return !q || `${a.surname} ${a.firstNames} ${a.applicationNumber} ${a.parentName || ""} ${a.parentPhone || ""} ${a.parentEmail || ""}`.toLowerCase().includes(q);
    });
  }, [apps, tab, query, classFilter]);

  function openApp(a: App) {
    setOpen(a);
    setReason("");
    setAdmissionNo("");
    setEnrolClass(a.desiredClassId || "");
    setError(null);
  }

  async function act(action: "review" | "approve" | "reject" | "enrol", extra: Record<string, unknown> = {}, confirmText?: string) {
    if (!open) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const { res, json } = await api("/api/admin/admissions", { method: "POST", body: JSON.stringify({ id: open.id, action, ...extra }) });
      if (!res.ok || !json.ok) throw new Error(json.error || "That did not work.");
      const mail = action === "review" ? "" : json.emailed ? " The parent was emailed." : " No email was sent (email is off or none on file).";
      setToast(
        action === "enrol"
          ? `${json.student.name} is now a student: ${json.student.admissionNo}, ${json.student.className}.${mail}${json.warning ? ` ${json.warning}` : ""}`
          : `Application ${action === "review" ? "moved to review" : action === "approve" ? "approved" : "rejected"}.${mail}`
      );
      setOpen(null);
      await load();
      if (action === "approve") setTab("approved");
      if (action === "enrol") setTab("enrolled");
      if (action === "reject") setTab("rejected");
      if (action === "review") setTab("under_review");
      setTimeout(() => setToast(null), 9000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!apps && !error) return <PageLoader label="Loading applications…" />;

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Admission Applicants</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            A paid application appears under <strong>New</strong>. Review it, approve or reject it, and when approved, enrol it to create the student, login and class place in one step.
          </p>
        </div>
        <Link href="/admin/admissions/forms" className="text-xs font-semibold text-blue-600 hover:text-blue-800 whitespace-nowrap">
          Application forms &amp; fee →
        </Link>
      </div>

      {toast && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">{toast}</div>}
      {error && !open && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            type="button"
            title={t.hint}
            onClick={() => setTab(t.key)}
            className={`px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer ${tab === t.key ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"}`}
          >
            {t.label} <span className={`ml-1 ${tab === t.key ? "text-slate-300" : "text-slate-400"}`}>{counts[t.key] || 0}</span>
            {t.key === "submitted" && (counts.submitted || 0) > 0 && tab !== "submitted" && <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-rose-500 align-middle" />}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, application number or parent…" className="flex-1 min-w-[200px] px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
          <option value="">All classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl py-14 text-center text-sm text-slate-400">Nothing here{query || classFilter ? " matches your search" : " yet"}.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => (
            <button key={a.id} type="button" onClick={() => openApp(a)} className="text-left bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs hover:border-slate-300 hover:shadow-sm cursor-pointer flex gap-3">
              {a.passportUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.passportUrl} alt="" className="w-14 h-14 rounded-xl object-cover bg-slate-100 shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center text-lg font-bold shrink-0">{(a.surname || "?").charAt(0)}</div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">
                  {a.surname} {a.firstNames}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {a.desiredClass || "No class chosen"} · {a.applicationNumber}
                </div>
                <div className="text-[11px] text-slate-500 truncate">{a.parentName || "Parent not stated"}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 items-center">
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${a.paid?.status === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
                    {a.paid?.status === "success" ? `Paid ${naira(a.paid.amount)}` : "Not paid"}
                  </span>
                  <span className="text-[10px] text-slate-400">{day(a.createdAt)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Details and actions */}
      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 p-3 sm:p-6">
          <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-xl border border-slate-200">
            <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {open.surname} {open.firstNames}
                </h3>
                <p className="text-xs text-slate-500">
                  {open.applicationNumber} · applied {day(open.createdAt)} · <span className="font-semibold uppercase">{open.status.replace("_", " ")}</span>
                </p>
              </div>
              <button type="button" onClick={() => setOpen(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none cursor-pointer" aria-label="Close">
                &times;
              </button>
            </div>

            <div className="p-5 space-y-5">
              {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

              <div className="flex gap-4">
                {open.passportUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={open.passportUrl} alt="Passport" className="w-24 h-24 rounded-xl object-cover bg-slate-100 shrink-0" />
                )}
                <div className="grid grid-cols-2 gap-3 flex-1">
                  <Field label="Class applied for" value={open.desiredClass} />
                  <Field label="Gender" value={open.gender} />
                  <Field label="Date of birth" value={open.dateOfBirth && day(open.dateOfBirth)} />
                  <Field label="State of origin" value={open.stateOfOrigin} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Parent / guardian" value={open.parentName} />
                <Field label="Occupation" value={open.parentOccupation} />
                <Field label="Phone" value={open.parentPhone} />
                <Field label="Email" value={open.parentEmail} />
                <Field label="Home address" value={open.homeAddress} />
                <Field label="Previous school" value={[open.previousSchool, open.previousClass].filter(Boolean).join(" · ")} />
                <Field label="Boarding" value={open.isBoarding ? `Yes (${open.boardingType || "full"})` : "No"} />
                <Field label="Medical notes" value={open.medicalConditions} />
                <Field label="Application fee" value={open.paid ? `${naira(open.paid.amount)} · ${open.paid.status}${open.paid.paidAt ? ` · ${day(open.paid.paidAt)}` : ""}` : "Not paid"} />
              </div>

              {open.status === "rejected" && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">Rejected{open.rejectionReason ? `: ${open.rejectionReason}` : "."} The application fee is kept.</div>}
              {open.status === "enrolled" && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                  Enrolled as <strong>{open.studentAdmissionNo}</strong>. <Link href="/admin/students" className="underline font-semibold">Open in Manage Students</Link>
                </div>
              )}
              {open.status === "draft" && <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">The parent started this application but the fee is not paid, so it can&rsquo;t be processed yet.</div>}

              {/* Actions */}
              {(open.status === "submitted" || open.status === "under_review") && (
                <div className="space-y-3 pt-1 border-t border-slate-100">
                  <div className="flex flex-wrap gap-2 pt-3">
                    {open.status === "submitted" && (
                      <button type="button" disabled={busy} onClick={() => act("review")} className="px-4 py-2 border border-slate-300 text-slate-800 font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40">
                        Start review
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act("approve", {}, `Approve ${open.surname} ${open.firstNames}? The parent will be emailed.`)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40"
                    >
                      {busy ? "Working…" : "Approve"}
                    </button>
                  </div>
                  <div className="space-y-2">
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Reason for rejecting (shown to the parent, optional)" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act("reject", { reason }, "Reject this application? The parent will be emailed and the application fee is kept.")}
                      className="px-4 py-2 text-rose-700 border border-rose-200 hover:bg-rose-50 font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {open.status === "approved" && (
                <div className="space-y-3 pt-1 border-t border-slate-100">
                  <h4 className="text-sm font-bold text-slate-900 pt-3">Enrol as a student</h4>
                  <p className="text-xs text-slate-500">
                    This creates the student record from the application, the login (password <strong>gracemark</strong>, changed at first sign-in) and the class place for the current session, then emails the parent.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Admission number
                      <input value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value.toUpperCase())} placeholder="e.g. GMA2601" className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800 font-mono" />
                    </label>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Class
                      <select value={enrolClass} onChange={(e) => setEnrolClass(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800">
                        <option value="">Choose a class</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || !admissionNo.trim() || !enrolClass}
                      onClick={() => act("enrol", { admission_no: admissionNo, class_id: enrolClass }, `Enrol ${open.surname} ${open.firstNames} as ${admissionNo.trim()}? This creates their login and class place.`)}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40"
                    >
                      {busy ? "Enrolling…" : "Enrol student"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => act("reject", { reason: "" }, "Reject this approved application instead? The parent will be emailed.")} className="px-4 py-2 text-rose-700 border border-rose-200 hover:bg-rose-50 font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40">
                      Reject instead
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
