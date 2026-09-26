"use client";

import React, { useEffect, useState } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import ReportSheet from "@/components/results/ReportSheet";
import { Skeleton } from "@/components/shared/Skeleton";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import { getAcademicSessions } from "@/lib/academicSessions";
import { printWithTitle } from "@/lib/printTitle";
import { downloadReportsZip } from "@/lib/reportPdfZip";

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];
const MILESTONES = [
  { value: "PR1", label: "Progress Report 1" },
  { value: "PR2", label: "Progress Report 2" },
  { value: "PR3", label: "Progress Report 3" },
  { value: "TR", label: "Terminal Result" },
];

export default function BulkReportCardsPage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const [classId, setClassId] = useState("");
  const [session, setSession] = useState("");
  const [term, setTerm] = useState("term1");
  const [milestone, setMilestone] = useState("TR");
  const [reports, setReports] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: cl }, sess, settings] = await Promise.all([
        supabase.from("classes").select("id, name").order("name"),
        getAcademicSessions(),
        getAppSettings(),
      ]);
      setClasses(cl || []);
      const names = sess.map((s) => s.name);
      setSessions(names);
      setSession(settings?.current_session || names[0] || "");
      if (settings?.current_term) setTerm(settings.current_term);
      if (cl?.length) setClassId(cl[0].id);
    })();
  }, []);

  const className = classes.find((c) => c.id === classId)?.name || "";
  const termLabel = TERMS.find((t) => t.value === term)?.label || term;
  const milestoneLabel = MILESTONES.find((m) => m.value === milestone)?.label || milestone;

  async function loadReports() {
    if (!classId || !session) return;
    setLoading(true);
    setError("");
    setReports(null);
    try {
      const params = new URLSearchParams({ class_id: classId, session, term, milestone });
      const res = await fetch(`/api/admin/reports/bulk?${params.toString()}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load report cards.");
      setReports(json.reports);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleZip() {
    if (!reports?.length || zipProgress) return;
    setError("");
    setZipProgress({ done: 0, total: reports.length });
    try {
      await downloadReportsZip(reports, {
        label: milestoneLabel,
        zipName: `${className} - ${milestoneLabel} - ${termLabel} ${session}`,
        onProgress: (done, total) => setZipProgress({ done, total }),
      });
    } catch (e: any) {
      setError(e?.message || "Could not create the ZIP file.");
    } finally {
      setZipProgress(null);
    }
  }

  function handlePrint() {
    printWithTitle(`${className} - ${milestoneLabel} - ${termLabel} ${session} - Report Cards`);
  }

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <header className="print:hidden bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 sticky top-0 z-20">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Bulk Report Cards</h1>
          <p className="text-sm text-slate-500 mt-1">
            Print or save a whole class&rsquo;s published report cards as one PDF, one student per page.
          </p>
        </header>

        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-5 print:p-0 print:max-w-none">
          <div className="print:hidden flex flex-wrap items-end gap-3">
            <Select label="Class" value={classId} onChange={setClassId} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            <Select label="Session" value={session} onChange={setSession} options={sessions.map((s) => ({ value: s, label: s }))} />
            <Select label="Term" value={term} onChange={setTerm} options={TERMS} />
            <Select label="Report" value={milestone} onChange={setMilestone} options={MILESTONES} />
            <button
              type="button"
              onClick={loadReports}
              disabled={loading || !classId}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-bold disabled:opacity-50 cursor-pointer"
            >
              {loading ? "Loading…" : "Load report cards"}
            </button>
            {reports && reports.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleZip}
                  disabled={!!zipProgress}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold disabled:opacity-60 cursor-pointer"
                >
                  {zipProgress ? `Creating PDFs ${zipProgress.done}/${zipProgress.total}…` : `Download ZIP (${reports.length} PDFs)`}
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={!!zipProgress}
                  className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg text-sm font-bold disabled:opacity-60 cursor-pointer"
                >
                  Print all
                </button>
              </>
            )}
          </div>

          {reports && reports.length > 0 && (
            <div className="print:hidden space-y-2">
              <p className="text-xs text-slate-500">
                <strong>Download ZIP</strong> gives one PDF per student, named like{" "}
                <em>{reports[0]?.student?.name} - {milestoneLabel}.pdf</em>. <strong>Print all</strong> sends the whole class to the printer, one student per page.
              </p>
              {zipProgress && (
                <div className="h-1.5 w-full max-w-md rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={zipProgress.total} aria-valuenow={zipProgress.done}>
                  <div className="h-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${(zipProgress.done / zipProgress.total) * 100}%` }} />
                </div>
              )}
            </div>
          )}

          {error && <div className="print:hidden rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

          {loading && (
            <div className="print:hidden space-y-3" role="status" aria-label="Loading report cards">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <Skeleton block className="h-5 w-48" />
                  <Skeleton block className="h-3 w-full" />
                  <Skeleton block className="h-3 w-5/6" />
                </div>
              ))}
            </div>
          )}

          {reports && reports.length === 0 && !loading && (
            <div className="print:hidden rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
              No published {milestoneLabel} for {className} in {termLabel} {session}. Publish it from Approvals first.
            </div>
          )}

          {reports && reports.length > 0 && (
            <div className="bulk-reports space-y-6 print:space-y-0">
              {reports.map((r) => (
                <div key={r.student.id} className="bulk-report-page">
                  <ReportSheet report={r} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 normal-case tracking-normal"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
