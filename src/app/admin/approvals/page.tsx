"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import ReportSheet from "@/components/results/ReportSheet";

type Milestone = "PR1" | "PR2" | "PR3" | "TR";
type Tab = "review" | "publish" | "settings";

interface Issue {
  level: "block" | "warn";
  code: string;
  message: string;
  details: string[];
}
interface GridRow {
  subjectId: string;
  name: string;
  teachers: string[];
  counts: Record<string, number>;
  missing: number;
  notOffering: number;
  returnReason: string | null;
  lastUpdated: string | null;
}
interface MilestoneState {
  milestone: Milestone;
  published: boolean;
  publishedAt: string | null;
  reportCount: number;
  issues: Issue[];
  students: { id: string; name: string }[];
}
interface Overview {
  term: string;
  session: string;
  classSize: number;
  grid: GridRow[];
  milestones: MilestoneState[];
}

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

const MILESTONE_INFO: Record<Milestone, { title: string; hint: string }> = {
  PR1: { title: "Progress Report 1", hint: "Weeks 1–4 · Test 1" },
  PR2: { title: "Progress Report 2", hint: "Weeks 1–6 · Tests 1–2" },
  PR3: { title: "Progress Report 3", hint: "Weeks 1–10 · Tests 1–3 · Project" },
  TR: { title: "Terminal Result", hint: "CA + Exam · GPA · Position" },
};

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()), ...(init?.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "block" ? -1 : 1));
  return (
    <ul className="space-y-1.5">
      {sorted.map((issue, i) => (
        <li key={i} className={`rounded-lg border px-2.5 py-1.5 text-xs ${issue.level === "block" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {issue.details.length ? (
            <details>
              <summary className="cursor-pointer font-semibold">
                {issue.level === "block" ? "Blocking: " : ""}
                {issue.message}
              </summary>
              <p className="mt-1 font-normal">{issue.details.join(", ")}</p>
            </details>
          ) : (
            <span className="font-semibold">
              {issue.level === "block" ? "Blocking: " : ""}
              {issue.message}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function AdminApprovalsPage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [classId, setClassId] = useState("");
  const [term, setTerm] = useState("");
  const [tab, setTab] = useState<Tab>("review");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Review
  const [openSubject, setOpenSubject] = useState<string | null>(null);
  const [subjectRows, setSubjectRows] = useState<any[]>([]);
  const [returnFor, setReturnFor] = useState<GridRow | null>(null);
  const [returnReason, setReturnReason] = useState("");

  // Publish
  const [confirm, setConfirm] = useState<{ kind: "publish" | "recall"; milestone: Milestone } | null>(null);
  const [preview, setPreview] = useState<{ milestone: Milestone; studentId: string; report: any | null; loading: boolean } | null>(null);

  // Settings
  const [signature, setSignature] = useState<string | null>(null);
  const [nextTerm, setNextTerm] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    supabase
      .from("classes")
      .select("id, name")
      .order("display_order")
      .then(({ data }) => {
        setClasses(data || []);
        if (data?.length) setClassId((prev) => prev || data[0].id);
      });
  }, []);

  const loadOverview = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    setError(null);
    try {
      const { res, json } = await api(`/api/admin/results/overview?class_id=${classId}${term ? `&term=${term}` : ""}`);
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load results.");
      setOverview(json);
      if (!term) setTerm(json.term);
    } catch (e: any) {
      setError(e.message);
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, [classId, term]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const loadSettings = useCallback(async () => {
    if (!term) return;
    const { res, json } = await api(`/api/admin/report-settings?term=${term}`);
    if (res.ok && json.ok) {
      setSignature(json.signature);
      setNextTerm(json.nextTermBegins || "");
    }
  }, [term]);

  useEffect(() => {
    if (tab === "settings") loadSettings();
  }, [tab, loadSettings]);

  // ---------------- Review ----------------
  async function toggleSubject(row: GridRow) {
    if (openSubject === row.subjectId) {
      setOpenSubject(null);
      return;
    }
    setOpenSubject(row.subjectId);
    setSubjectRows([]);
    const { data: students } = await supabase.from("students").select("id").eq("class_id", classId);
    const { data } = await supabase
      .from("results")
      .select("id, status, cw, hw, test, project, exam, total, grade, students(name, admission_no)")
      .eq("subject_id", row.subjectId)
      .eq("term", term)
      .eq("session", overview?.session || "")
      .in("student_id", (students || []).map((s: any) => s.id));
    setSubjectRows(((data as any[]) || []).sort((a, b) => (a.students?.name || "").localeCompare(b.students?.name || "")));
  }

  async function review(row: GridRow, action: "approve" | "return", reason?: string) {
    setBusy(`${action}:${row.subjectId}`);
    try {
      const { res, json } = await api("/api/admin/results/review", {
        method: "POST",
        body: JSON.stringify({ class_id: classId, subject_id: row.subjectId, term, action, reason }),
      });
      if (!res.ok || !json.ok) throw new Error(json.error || "Action failed.");
      flash(action === "approve" ? `${row.name}: ${json.updated} score(s) approved.` : `${row.name} returned to the teacher.`);
      setReturnFor(null);
      setReturnReason("");
      setOpenSubject(null);
      await loadOverview();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  // ---------------- Publish ----------------
  async function doPublish(milestone: Milestone, force: boolean) {
    setBusy(`publish:${milestone}`);
    setError(null);
    try {
      const { res, json } = await api("/api/admin/results/publish", {
        method: "POST",
        body: JSON.stringify({ class_id: classId, term, milestone, force }),
      });
      if (!res.ok || !json.ok) throw new Error(json.error || (json.needsConfirm ? "Please confirm the warnings." : "Publish failed."));
      flash(`${MILESTONE_INFO[milestone].title} published for ${json.published} student(s).`);
      setConfirm(null);
      await loadOverview();
    } catch (e: any) {
      setError(e.message);
      setConfirm(null);
      await loadOverview();
    } finally {
      setBusy(null);
    }
  }

  async function doRecall(milestone: Milestone) {
    setBusy(`recall:${milestone}`);
    try {
      const { res, json } = await api("/api/admin/results/recall", {
        method: "POST",
        body: JSON.stringify({ class_id: classId, term, milestone }),
      });
      if (!res.ok || !json.ok) throw new Error(json.error || "Recall failed.");
      flash(`${MILESTONE_INFO[milestone].title} recalled. Students can no longer see it.`);
      setConfirm(null);
      await loadOverview();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function openPreview(milestone: Milestone, studentId?: string) {
    const ms = overview?.milestones.find((m) => m.milestone === milestone);
    const sid = studentId || ms?.students[0]?.id || "";
    setPreview({ milestone, studentId: sid, report: null, loading: true });
    const { json } = await api(`/api/admin/results/preview?class_id=${classId}&term=${term}&milestone=${milestone}&student_id=${sid}`);
    setPreview({ milestone, studentId: sid, report: json.report || null, loading: false });
  }

  // ---------------- Settings ----------------
  function onSignatureFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      const { res, json } = await api("/api/admin/report-settings", { method: "POST", body: JSON.stringify({ signature: dataUrl }) });
      if (!res.ok || !json.ok) return setError(json.error || "Upload failed.");
      setSignature(dataUrl);
      flash("Principal's signature saved. It appears on terminal results published from now on.");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function saveNextTerm() {
    const { res, json } = await api("/api/admin/report-settings", {
      method: "POST",
      body: JSON.stringify({ term, next_term_begins: nextTerm || null }),
    });
    if (!res.ok || !json.ok) return setError(json.error || "Save failed.");
    flash("Next term resumption date saved.");
  }

  const confirmMs = confirm ? overview?.milestones.find((m) => m.milestone === confirm.milestone) : null;
  const className = classes.find((c) => c.id === classId)?.name || "";
  const termLabel = TERMS.find((t) => t.value === term)?.label || "";

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Result Approvals &amp; Publishing</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Approve teachers&rsquo; scores, then release each report to students when it is ready.
            {overview?.session ? ` Session ${overview.session}.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Class
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="mt-1 block w-44 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 normal-case tracking-normal">
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Term
            <select value={term} onChange={(e) => setTerm(e.target.value)} className="mt-1 block w-32 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 normal-case tracking-normal">
              {TERMS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" className="inline-flex rounded-xl bg-slate-100 p-1">
        {(
          [
            ["review", "1. Review scores"],
            ["publish", "2. Publish results"],
            ["settings", "Report settings"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {toast && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">{toast}</div>}
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer" aria-label="Dismiss">
            &times;
          </button>
        </div>
      )}

      {loading && !overview ? (
        <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
      ) : !overview ? null : tab === "review" ? (
        /* ---------------- REVIEW ---------------- */
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500">
            {className} · {termLabel} · {overview.classSize} students. Numbers show how many students&rsquo; scores are in each state. Only{" "}
            <strong>submitted</strong> scores can be approved or returned; if a teacher edits approved scores they go back to draft.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-left">
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-2 py-2.5 text-center">Submitted</th>
                  <th className="px-2 py-2.5 text-center">Approved</th>
                  <th className="px-2 py-2.5 text-center">Draft</th>
                  <th className="px-2 py-2.5 text-center">Returned</th>
                  <th className="px-2 py-2.5 text-center" title="Students who take this subject but have no scores entered yet">Not entered yet</th>
                  <th className="px-2 py-2.5 text-center">Not offering</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.grid.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                      This class has no subject list. Set one up under Class Subject Lists.
                    </td>
                  </tr>
                )}
                {overview.grid.map((row) => {
                  const submitted = row.counts.submitted || 0;
                  const approved = row.counts.approved || 0;
                  const allApproved = approved > 0 && !submitted && !row.counts.draft && !row.counts.returned && !row.missing;
                  return (
                    <React.Fragment key={row.subjectId}>
                      <tr className={openSubject === row.subjectId ? "bg-slate-50" : ""}>
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-900 flex items-center gap-2">
                            {row.name}
                            {allApproved && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">All approved</span>}
                          </div>
                          <div className="text-[11px] text-slate-500">{row.teachers.length ? row.teachers.join(", ") : "No teacher assigned"}</div>
                          {row.returnReason && <div className="text-[11px] text-rose-600 mt-0.5">Returned: {row.returnReason}</div>}
                        </td>
                        <td className="px-2 py-2.5 text-center font-bold text-sky-700">{submitted || "—"}</td>
                        <td className="px-2 py-2.5 text-center font-bold text-emerald-700">{approved || "—"}</td>
                        <td className="px-2 py-2.5 text-center text-slate-600">{row.counts.draft || "—"}</td>
                        <td className="px-2 py-2.5 text-center text-rose-600">{row.counts.returned || "—"}</td>
                        <td
                          className={`px-2 py-2.5 text-center ${row.missing ? "text-amber-700 font-semibold" : "text-slate-400"}`}
                          title={row.missing ? `${row.missing} student(s) have no ${row.name} scores yet` : undefined}
                        >
                          {row.missing ? `${row.missing} student${row.missing === 1 ? "" : "s"}` : "—"}
                        </td>
                        <td className="px-2 py-2.5 text-center text-slate-400">{row.notOffering || "—"}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button type="button" onClick={() => toggleSubject(row)} className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer">
                            {openSubject === row.subjectId ? "Hide" : "View"}
                          </button>
                          <button
                            type="button"
                            disabled={!submitted || !!busy}
                            onClick={() => {
                              setReturnFor(row);
                              setReturnReason("");
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 rounded-md disabled:opacity-30 cursor-pointer"
                          >
                            Return
                          </button>
                          <button
                            type="button"
                            disabled={!submitted || !!busy}
                            onClick={() => review(row, "approve")}
                            className="ml-1 px-3 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-30 cursor-pointer"
                          >
                            {busy === `approve:${row.subjectId}` ? "Approving…" : `Approve${submitted ? ` ${submitted}` : ""}`}
                          </button>
                        </td>
                      </tr>
                      {openSubject === row.subjectId && (
                        <tr>
                          <td colSpan={8} className="px-4 pb-4 bg-slate-50">
                            <table className="w-full text-[11px] bg-white border border-slate-200 rounded-lg overflow-hidden">
                              <thead>
                                <tr className="text-slate-500 bg-slate-50">
                                  <th className="px-2 py-1.5 text-left">Student</th>
                                  <th className="px-2 py-1.5">CW /10</th>
                                  <th className="px-2 py-1.5">HW /5</th>
                                  <th className="px-2 py-1.5">Test /10</th>
                                  <th className="px-2 py-1.5">Proj /5</th>
                                  <th className="px-2 py-1.5">Exam /70</th>
                                  <th className="px-2 py-1.5">Total</th>
                                  <th className="px-2 py-1.5">Grade</th>
                                  <th className="px-2 py-1.5">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {subjectRows.length === 0 ? (
                                  <tr>
                                    <td colSpan={9} className="px-2 py-4 text-center text-slate-400">
                                      No scores entered yet.
                                    </td>
                                  </tr>
                                ) : (
                                  subjectRows.map((r) => (
                                    <tr key={r.id} className="border-t border-slate-100 text-center tabular-nums">
                                      <td className="px-2 py-1 text-left font-semibold text-slate-800">{r.students?.name}</td>
                                      <td className="px-2 py-1">{r.cw}</td>
                                      <td className="px-2 py-1">{r.hw}</td>
                                      <td className="px-2 py-1">{r.test}</td>
                                      <td className="px-2 py-1">{r.project}</td>
                                      <td className="px-2 py-1">{r.exam}</td>
                                      <td className="px-2 py-1 font-bold">{r.total}</td>
                                      <td className="px-2 py-1 font-bold">{r.grade}</td>
                                      <td className="px-2 py-1 capitalize text-slate-500">{r.status}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                            <p className="text-[10px] text-slate-500 mt-1.5">Running terminal-result figures so far. Progress report figures are in &ldquo;Preview as student&rdquo;.</p>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "publish" ? (
        /* ---------------- PUBLISH ---------------- */
        <div className="grid md:grid-cols-2 gap-4">
          {overview.milestones.map((ms) => {
            const info = MILESTONE_INFO[ms.milestone];
            const blocked = ms.issues.some((i) => i.level === "block");
            const canPublish = !blocked && ms.reportCount > 0;
            return (
              <div key={ms.milestone} className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{info.title}</h3>
                    <p className="text-[11px] text-slate-500">{info.hint}</p>
                  </div>
                  {ms.published ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full text-right">
                      Published
                      {ms.publishedAt && <span className="block font-semibold normal-case tracking-normal">{fmtDateTime(ms.publishedAt)}</span>}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Not published</span>
                  )}
                </div>

                <div className="flex-1">
                  {ms.reportCount === 0 && !ms.issues.length ? (
                    <p className="text-xs text-slate-400">No scores entered for this report yet.</p>
                  ) : ms.issues.length === 0 ? (
                    <p className="text-xs font-semibold text-emerald-700">Ready: {ms.reportCount} student reports, no problems found.</p>
                  ) : (
                    <IssueList issues={ms.issues} />
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={!ms.reportCount}
                    onClick={() => openPreview(ms.milestone)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                  >
                    Preview as student
                  </button>
                  {ms.published && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => setConfirm({ kind: "recall", milestone: ms.milestone })}
                      className="px-3 py-1.5 text-xs font-semibold text-rose-700 border border-rose-200 rounded-lg hover:bg-rose-50 disabled:opacity-40 cursor-pointer"
                    >
                      Recall
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!canPublish || !!busy}
                    onClick={() => setConfirm({ kind: "publish", milestone: ms.milestone })}
                    title={blocked ? "Fix the blocking issues first" : undefined}
                    className="px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                  >
                    {ms.published ? "Republish" : "Publish"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ---------------- SETTINGS ---------------- */
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-4">
            <h3 className="text-sm font-bold text-slate-900">Principal&rsquo;s signature</h3>
            <p className="text-xs text-slate-500 mt-0.5">Printed on terminal results. Use a PNG with a transparent or white background.</p>
            <div className="mt-3 h-20 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center">
              {signature ? <img src={signature} alt="Principal's signature" className="max-h-16 object-contain" /> : <span className="text-xs text-slate-400">No signature uploaded</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onSignatureFile} />
            <button type="button" onClick={() => fileRef.current?.click()} className="mt-3 px-3 py-1.5 text-xs font-bold text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
              {signature ? "Replace signature" : "Upload signature"}
            </button>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-4">
            <h3 className="text-sm font-bold text-slate-900">Next term begins</h3>
            <p className="text-xs text-slate-500 mt-0.5">Shown on the {termLabel} terminal result ({overview.session}).</p>
            <div className="mt-3 flex items-center gap-2">
              <input type="date" value={nextTerm} onChange={(e) => setNextTerm(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              <button type="button" onClick={saveNextTerm} className="px-3.5 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer">
                Save
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Already-published results keep the date they were published with. Republish to update them.</p>
          </div>
        </div>
      )}

      {/* Return modal */}
      {returnFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 border border-slate-200">
            <h3 className="font-bold text-slate-900">Return {returnFor.name} to the teacher</h3>
            <p className="text-xs text-slate-500 mt-1">The teacher sees this message and can correct and resubmit.</p>
            <textarea
              autoFocus
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              rows={4}
              placeholder="e.g. Test 2 scores look swapped with Test 1."
              className="mt-3 w-full p-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={() => setReturnFor(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                disabled={!returnReason.trim() || !!busy}
                onClick={() => review(returnFor, "return", returnReason)}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-40 cursor-pointer"
              >
                Return scores
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish / recall confirmation */}
      {confirm && confirmMs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 border border-slate-200 max-h-[90vh] overflow-y-auto">
            {confirm.kind === "publish" ? (
              <>
                <h3 className="font-bold text-slate-900">
                  {confirmMs.published ? "Republish" : "Publish"} {MILESTONE_INFO[confirm.milestone].title}?
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  {confirmMs.reportCount} students in {className} will see this {termLabel} report. It is saved exactly as it is now; later score changes
                  only reach students if you republish.
                </p>
                {confirmMs.issues.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-amber-800 mb-1.5">Please check these warnings first:</p>
                    <IssueList issues={confirmMs.issues} />
                  </div>
                )}
                <div className="flex justify-end gap-2 mt-4">
                  <button type="button" onClick={() => setConfirm(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 cursor-pointer">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => doPublish(confirm.milestone, confirmMs.issues.length > 0)}
                    className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-40 cursor-pointer"
                  >
                    {busy ? "Publishing…" : confirmMs.issues.length ? "Publish anyway" : "Publish"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-bold text-slate-900">Recall {MILESTONE_INFO[confirm.milestone].title}?</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Students in {className} will no longer see this {termLabel} report. Scores and approvals are not changed, so you can publish it again later.
                </p>
                <div className="flex justify-end gap-2 mt-4">
                  <button type="button" onClick={() => setConfirm(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 cursor-pointer">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => doRecall(confirm.milestone)}
                    className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-40 cursor-pointer"
                  >
                    {busy ? "Recalling…" : "Recall"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Preview as student */}
      {preview && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 p-3 sm:p-6">
          <div className="max-w-5xl mx-auto bg-slate-100 rounded-2xl p-3 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-600">
                <strong>Preview</strong> of {MILESTONE_INFO[preview.milestone].title}, exactly as it would be published now.
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={preview.studentId}
                  onChange={(e) => openPreview(preview.milestone, e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold bg-white"
                >
                  {(overview?.milestones.find((m) => m.milestone === preview.milestone)?.students || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setPreview(null)} className="px-3 py-1.5 text-xs font-bold bg-white border border-slate-300 rounded-lg cursor-pointer">
                  Close
                </button>
              </div>
            </div>
            {preview.loading ? (
              <div className="py-16 text-center text-sm text-slate-500">Building preview…</div>
            ) : preview.report ? (
              <ReportSheet report={preview.report} />
            ) : (
              <div className="py-16 text-center text-sm text-slate-500">No report for this student yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
