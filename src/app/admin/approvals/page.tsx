"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  calculatePR1,
  calculatePR2,
  calculatePR3,
  calculateTR,
  normalizeBreakdown,
  isSeniorClass,
  computeClassSubjectStats,
} from "@/lib/gradingEngine";
import { ResultRecord, ClassRecord, SubjectRecord } from "@/types/database";

export default function AdminApprovalsPage() {
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [currentTerm, setCurrentTerm] = useState("term1");
  const [currentSession, setCurrentSession] = useState("");

  const [results, setResults] = useState<ResultRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState("");

  // Return Modal
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");

  // Milestone publishing
  const [selectedMilestone, setSelectedMilestone] = useState<"PR1" | "PR2" | "PR3" | "TR">("TR");
  const [publishing, setPublishing] = useState(false);

  // Principal Signature
  const [signatureBase64, setSignatureBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resumption Date
  const [resumptionDate, setResumptionDate] = useState("");

  const selectedClassName = classes.find((c) => c.id === selectedClass)?.name || "";
  const isSenior = isSeniorClass(selectedClassName);

  const loadInitialData = useCallback(async () => {
    try {
      // 1. Settings
      const { data: settings } = await supabase.from("app_settings").select("*").limit(1).maybeSingle();
      if (settings) {
        if (settings.current_term) setCurrentTerm(settings.current_term);
        if (settings.current_session) setCurrentSession(settings.current_session);
        if (settings.resumption_date) setResumptionDate(settings.resumption_date);
      }

      // 2. Classes
      const { data: clData } = await supabase.from("classes").select("id, name").order("name");
      setClasses(clData || []);
      if (clData?.length) setSelectedClass(clData[0].id);

      // 3. Signature
      const { data: sig } = await supabase
        .from("signatures")
        .select("signature_data")
        .eq("title", "principal")
        .maybeSingle();

      if (sig?.signature_data) {
        setSignatureBase64(sig.signature_data);
      } else if (typeof window !== "undefined") {
        const localSig = localStorage.getItem("gracemark_principal_sig_base64");
        if (localSig) setSignatureBase64(localSig);
      }
    } catch (err) {
      console.error("Initial approvals load error:", err);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Load subjects for selected class
  const loadSubjects = useCallback(async () => {
    if (!selectedClass) return;
    try {
      const { data } = await supabase
        .from("results")
        .select("subject_id, subjects(id, name)")
        .eq("class_id", selectedClass)
        .eq("term", currentTerm);

      const map = new Map<string, SubjectRecord>();
      (data || []).forEach((r: any) => {
        if (r.subjects) map.set(r.subject_id, r.subjects);
      });

      let list = Array.from(map.values());
      if (!list.length) {
        const { data: allSub } = await supabase.from("subjects").select("id, name").order("name");
        list = allSub || [];
      }

      setSubjects(list);
      if (list.length && !selectedSubject) setSelectedSubject(list[0].id);
    } catch (err) {
      console.error("Load subjects error:", err);
    }
  }, [selectedClass, currentTerm, selectedSubject]);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  // Load results
  const loadResults = useCallback(async () => {
    if (!selectedClass || !selectedSubject) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("results")
        .select("*, students(id, name, admission_no, class_id), subjects(id, name)")
        .eq("class_id", selectedClass)
        .eq("subject_id", selectedSubject)
        .eq("term", currentTerm)
        .order("total", { ascending: false });

      if (error) throw error;
      setResults((data as ResultRecord[]) || []);
    } catch (err) {
      console.error("Load results error:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedClass, selectedSubject, currentTerm]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  // Actions
  async function handleApprove() {
    if (!results.length) return;
    try {
      const ids = results.map((r) => r.id);
      const { error } = await supabase
        .from("results")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
          return_reason: null,
        })
        .in("id", ids);

      if (error) throw error;
      setActionStatus("All submitted scores approved successfully!");
      loadResults();
      setTimeout(() => setActionStatus(""), 4000);
    } catch (err: any) {
      console.error("Approve error:", err);
      alert(`Approval failed: ${err.message}`);
    }
  }

  async function handleConfirmReturn() {
    if (!results.length) return;
    try {
      const ids = results.map((r) => r.id);
      const { error } = await supabase
        .from("results")
        .update({
          status: "returned",
          return_reason: returnReason.trim() || "Please review and revise scores.",
        })
        .in("id", ids);

      if (error) throw error;
      setIsReturnModalOpen(false);
      setReturnReason("");
      setActionStatus("Scores returned to teacher for correction.");
      loadResults();
      setTimeout(() => setActionStatus(""), 4000);
    } catch (err: any) {
      console.error("Return error:", err);
      alert(`Return failed: ${err.message}`);
    }
  }

  async function handleUnlock() {
    if (!results.length) return;
    try {
      const ids = results.map((r) => r.id);
      const { error } = await supabase
        .from("results")
        .update({ status: "draft" })
        .in("id", ids);

      if (error) throw error;
      setActionStatus("Scores unlocked for editing.");
      loadResults();
      setTimeout(() => setActionStatus(""), 4000);
    } catch (err: any) {
      console.error("Unlock error:", err);
      alert(`Unlock failed: ${err.message}`);
    }
  }

  // Batch Milestone Publishing
  async function handleBatchPublish() {
    if (!results.length) return;
    setPublishing(true);
    try {
      // 1. Fetch all subjects results for the entire class cohort
      let { data: allClassResults } = await supabase
        .from("results")
        .select("*, students(id, name, admission_no, class_id), subjects(id, name)")
        .eq("class_id", selectedClass)
        .eq("term", currentTerm);

      if (!allClassResults || allClassResults.length === 0) {
        const { data: stds } = await supabase.from("students").select("id").eq("class_id", selectedClass);
        const sIds = (stds || []).map((s) => s.id);
        if (sIds.length) {
          const { data: resByS } = await supabase
            .from("results")
            .select("*, students(id, name, admission_no, class_id), subjects(id, name)")
            .in("student_id", sIds)
            .eq("term", currentTerm);
          allClassResults = resByS || [];
        }
      }

      const allResultsList = (allClassResults && allClassResults.length > 0 ? allClassResults : results);

      const studentMap = new Map<string, any[]>();
      allResultsList.forEach((r: any) => {
        if (!studentMap.has(r.student_id)) studentMap.set(r.student_id, []);
        studentMap.get(r.student_id)!.push(r);
      });

      const snapshots = [];
      for (const [studentId, studentResList] of Array.from(studentMap.entries())) {
        const subjectsData = studentResList.map((r) => {
          const raw = normalizeBreakdown(r);
          if (selectedMilestone === "PR1") {
            const pr1 = calculatePR1(raw, isSenior);
            return {
              subject_name: r.subjects?.name || "Subject",
              cw: pr1.cw,
              hw: pr1.hw,
              test: pr1.test,
              total: pr1.totalCA,
              percentage: pr1.percentage,
              grade: pr1.grade,
              remark: pr1.remark,
            };
          } else if (selectedMilestone === "PR2") {
            const pr2 = calculatePR2(raw, isSenior);
            return {
              subject_name: r.subjects?.name || "Subject",
              cw: pr2.cw,
              hw: pr2.hw,
              test: pr2.test,
              total: pr2.totalCA,
              percentage: pr2.percentage,
              grade: pr2.grade,
              remark: pr2.remark,
            };
          } else if (selectedMilestone === "PR3") {
            const pr3 = calculatePR3(raw, isSenior);
            return {
              subject_name: r.subjects?.name || "Subject",
              cw: pr3.cw,
              hw: pr3.hw,
              test: pr3.test,
              total: pr3.totalCA,
              percentage: pr3.percentage,
              grade: pr3.grade,
              remark: pr3.remark,
            };
          } else {
            const tr = calculateTR(raw, { isSenior, className: selectedClassName });
            return {
              subject_name: r.subjects?.name || "Subject",
              cw: tr.scaled.cw,
              hw: tr.scaled.hw,
              test: tr.scaled.tests,
              project: tr.scaled.project,
              exam: tr.scaled.exam,
              total: tr.totalScore,
              grade: tr.grade,
              remark: tr.remark,
            };
          }
        });

        snapshots.push({
          student_id: studentId,
          class_id: selectedClass,
          term: currentTerm,
          session: currentSession,
          report_type: selectedMilestone,
          snapshot_data: {
            subjects: subjectsData,
            milestone: selectedMilestone,
            className: selectedClassName,
            published_at: new Date().toISOString(),
          },
        });
      }

      const statusCol =
        selectedMilestone === "PR1"
          ? { pr1_status: "published" }
          : selectedMilestone === "PR2"
          ? { pr2_status: "published" }
          : selectedMilestone === "PR3"
          ? { pr3_status: "published" }
          : { tr_status: "published", status: "published" };

      const resultIds = allResultsList.map((r: any) => r.id);

      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/results/batch-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token || ""}` },
        body: JSON.stringify({
          snapshots,
          resultIds,
          statusCol,
        }),
      });

      if (!res.ok) throw new Error("Batch publish request failed.");

      setActionStatus(`Successfully published ${selectedMilestone} reports for ${snapshots.length} students!`);
      loadResults();
      setTimeout(() => setActionStatus(""), 5000);
    } catch (err: any) {
      console.error("Batch publish error:", err);
      alert(`Publish failed: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  }

  // Unpublish
  async function handleUnpublish() {
    if (!confirm(`Are you sure you want to recall/unpublish ${selectedMilestone} reports for this class?`)) {
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/results/unpublish", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token || ""}` },
        body: JSON.stringify({
          classId: selectedClass,
          milestone: selectedMilestone,
          term: currentTerm,
          session: currentSession,
        }),
      });

      if (!res.ok) throw new Error("Unpublish failed.");
      setActionStatus(`Recalled ${selectedMilestone} reports for this cohort.`);
      loadResults();
      setTimeout(() => setActionStatus(""), 4000);
    } catch (err: any) {
      console.error("Unpublish error:", err);
      alert(`Unpublish failed: ${err.message}`);
    }
  }

  // Signature Upload
  async function handleSignatureUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        setSignatureBase64(base64);
        if (typeof window !== "undefined") {
          localStorage.setItem("gracemark_principal_sig_base64", base64);
        }

        try {
          await supabase.from("signatures").upsert({
            title: "principal",
            signature_data: base64,
            updated_at: new Date().toISOString(),
          }, { onConflict: "title" });
        } catch (_) {}
      }
    };
    reader.readAsDataURL(file);
  }

  // Save Resumption Date
  async function handleSaveResumption() {
    try {
      await supabase.from("app_settings").upsert({
        id: "default_school",
        resumption_date: resumptionDate,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      setActionStatus("Next term resumption date updated!");
      setTimeout(() => setActionStatus(""), 3500);
    } catch (err: any) {
      console.error("Save resumption date error:", err);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Result Approvals & Milestone Publishing
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Audit teacher score submissions, return for corrections, and publish checkpoint snapshots (PR1, PR2, PR3, TR).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleUnlock}
            disabled={!results.length}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
          >
            Unlock for Edit
          </button>
          <button
            type="button"
            onClick={() => setIsReturnModalOpen(true)}
            disabled={!results.length}
            className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
          >
            Return with Reason
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={!results.length}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            Approve Scores
          </button>
        </div>
      </div>

      {actionStatus && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
          {actionStatus}
        </div>
      )}

      {/* Selectors & Milestone Publishing Bar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1 w-44">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Class
            </label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 w-52">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Subject
            </label>
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Milestone Publish Controls */}
        <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
              Milestone Snapshot
            </span>
            <select
              value={selectedMilestone}
              onChange={(e) => setSelectedMilestone(e.target.value as any)}
              className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
            >
              <option value="PR1">PR1 (Week 4)</option>
              <option value="PR2">PR2 (Week 7)</option>
              <option value="PR3">PR3 (Week 10)</option>
              <option value="TR">Terminal Result (TR)</option>
            </select>
          </div>

          <button
            type="button"
            disabled={publishing || !results.length}
            onClick={handleBatchPublish}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50 self-end"
          >
            {publishing ? "Publishing…" : "Publish Milestone"}
          </button>
          <button
            type="button"
            disabled={publishing}
            onClick={handleUnpublish}
            className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer self-end"
          >
            Recall
          </button>
        </div>
      </div>

      {/* Signature & Resumption Date Card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Principal Signature */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex items-center justify-between gap-4">
          <div>
            <span className="text-xs font-bold text-slate-900 block">
              Official Principal Digital Signature
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Stamped automatically on published report cards and printouts.
            </p>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleSignatureUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
            >
              {signatureBase64 ? "Replace Signature Image" : "Upload Signature Image"}
            </button>
          </div>

          <div className="w-24 h-14 bg-slate-50 border border-dashed border-slate-300 rounded-xl flex items-center justify-center p-1 overflow-hidden shrink-0">
            {signatureBase64 ? (
              <img
                src={signatureBase64}
                alt="Principal Signature"
                className="max-h-full object-contain"
              />
            ) : (
              <span className="text-[10px] text-slate-400 italic">No signature</span>
            )}
          </div>
        </div>

        {/* Resumption Date */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col justify-between gap-2">
          <div>
            <span className="text-xs font-bold text-slate-900 block">
              Next Term Resumption Date
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Appears at the footer of all student academic report cards.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={resumptionDate}
              onChange={(e) => setResumptionDate(e.target.value)}
              placeholder="e.g. Monday, 12th January 2026"
              className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            <button
              type="button"
              onClick={handleSaveResumption}
              className="px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors shadow-2xs cursor-pointer"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Submitted Scores Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3.5">Student</th>
                <th className="px-3 py-3.5 text-center">CW (/10)</th>
                <th className="px-3 py-3.5 text-center">HW (/5)</th>
                <th className="px-3 py-3.5 text-center">Tests (/10)</th>
                <th className="px-3 py-3.5 text-center">Prj (/5)</th>
                <th className="px-3 py-3.5 text-center">Exam (/70)</th>
                <th className="px-4 py-3.5 text-center font-bold text-slate-900">Total (/100)</th>
                <th className="px-4 py-3.5 text-center">Grade</th>
                <th className="px-4 py-3.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    Loading submitted results…
                  </td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    No scores submitted for this class and subject.
                  </td>
                </tr>
              ) : (
                results.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3.5 font-bold text-slate-900">
                      <div>{r.students?.name}</div>
                      <div className="text-[10px] font-mono text-slate-400 font-normal">
                        {r.students?.admission_no}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-center">{r.cw ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.hw ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.test ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.project ?? 0}</td>
                    <td className="px-3 py-3.5 text-center">{r.exam ?? 0}</td>
                    <td className="px-4 py-3.5 text-center font-bold text-slate-900">
                      {r.total ?? 0}
                    </td>
                    <td className="px-4 py-3.5 text-center font-bold text-emerald-700">
                      {r.grade || "—"}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                          r.status === "approved"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : r.status === "published"
                            ? "bg-purple-50 text-purple-700 border-purple-200"
                            : r.status === "returned"
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Return With Reason Modal */}
      {isReturnModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-slate-200">
            <h3 className="font-bold text-base text-slate-900 tracking-tight mb-2">
              Return Scores to Teacher
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Enter feedback or correction instructions for the subject teacher.
            </p>

            <textarea
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="e.g. Please check student exam scores for Week 10 tests, scores appear transposed."
              rows={4}
              className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white resize-none"
            />

            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsReturnModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReturn}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs shadow-xs cursor-pointer"
              >
                Confirm Return
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
