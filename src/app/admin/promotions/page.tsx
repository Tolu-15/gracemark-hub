"use client";

import React, { useState, useEffect } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { supabase } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import { ensureClassByName } from "@/lib/schoolContext";

interface ClassItem {
  id: string;
  name: string;
  session?: string;
}

interface StudentItem {
  id: string;
  name: string;
  admission_no: string;
  class_id: string;
  classes?: { name: string } | null;
}

interface PromotionRecord {
  id: string;
  session: string;
  promoted_at: string;
  summary: any[];
  notes?: string | null;
}

function getNextSessionLogical(sessionStr: string): string {
  const match = sessionStr.match(/^(\d{4})\/(\d{4})$/);
  if (!match) return sessionStr;
  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  return `${start + 1}/${end + 1}`;
}

function getNextClassLogical(className?: string, jss3Track: string = "Science"): string {
  const name = String(className || "").trim().toUpperCase();
  if (name === "JSS 1" || name.startsWith("JSS 1")) return name.replace("JSS 1", "JSS 2");
  if (name === "JSS 2" || name.startsWith("JSS 2")) return name.replace("JSS 2", "JSS 3");
  if (name === "JSS 3" || name.startsWith("JSS 3")) return `SSS 1 ${jss3Track}`;
  if (name.includes("SSS 1")) return name.replace("SSS 1", "SSS 2");
  if (name.includes("SSS 2")) return name.replace("SSS 2", "SSS 3");
  if (name.includes("SSS 3")) return "ALUMNI (GRADUATED)";
  return "STAYS IN CLASS (CUSTOM)";
}

export default function AdminPromotionsPage() {
  const [loading, setLoading] = useState(true);
  const [currentSession, setCurrentSession] = useState("—");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentTerm, setCurrentTerm] = useState("term1");
  const [classList, setClassList] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [history, setHistory] = useState<PromotionRecord[]>([]);

  // Modal and config state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [jss3Track, setJss3Track] = useState<"Science" | "Arts" | "Commercial">("Science");
  const [targetNextSession, setTargetNextSession] = useState("");
  const [notes, setNotes] = useState("");
  const [processing, setProcessing] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const settings = await getAppSettings();
      const sess = settings?.current_session || "—";
      const trm = settings?.current_term || "term1";
      setCurrentSession(sess);
      setCurrentTerm(trm);
      setTargetNextSession(getNextSessionLogical(sess));

      // Fetch active session id
      const { data: sessRow } = await supabase
        .from("academic_sessions")
        .select("id, name")
        .eq("name", sess)
        .maybeSingle();
      if (sessRow?.id) {
        setCurrentSessionId(sessRow.id);
      }

      // Fetch classes
      const { data: clData, error: clErr } = await supabase
        .from("classes")
        .select("*")
        .order("name", { ascending: true });
      if (clErr) throw clErr;
      setClassList(clData || []);

      // Fetch active students
      const { data: stdData, error: stdErr } = await supabase
        .from("students")
        .select("id, name, admission_no, class_id, classes(name)")
        .eq("is_alumni", false);
      if (stdErr) throw stdErr;
      setStudents((stdData as any) || []);

      // Fetch promotions history
      const { data: histData, error: hErr } = await supabase
        .from("promotions")
        .select("id, session, promoted_at, summary, notes")
        .order("promoted_at", { ascending: false });
      if (hErr) throw hErr;
      setHistory((histData as any) || []);
    } catch (err: any) {
      console.error("Failed to load promotions data:", err);
      alert("Failed to load promotions data: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const studentCountMap = new Map<string, number>();
  students.forEach((s) => {
    studentCountMap.set(s.class_id, (studentCountMap.get(s.class_id) || 0) + 1);
  });

  const eligibleCount = students.filter((s) => {
    const next = getNextClassLogical(s.classes?.name, jss3Track);
    return next !== "STAYS IN CLASS (CUSTOM)";
  }).length;

  const handleOpenModal = () => {
    if (eligibleCount === 0) {
      alert("No active students are currently eligible for promotion.");
      return;
    }
    setIsModalOpen(true);
  };

  const handleExecutePromotion = async () => {
    setProcessing(true);
    try {
      const classMap = new Map<string, ClassItem>();
      classList.forEach((c) => classMap.set(c.name.trim().toUpperCase(), c));

      const promotionsPayload: any[] = [];
      for (const student of students) {
        const currentClassName = student.classes?.name || "";
        const nextClassName = getNextClassLogical(currentClassName, jss3Track);

        if (nextClassName === "ALUMNI (GRADUATED)") {
          promotionsPayload.push({
            studentId: student.id,
            studentName: student.name,
            fromClassId: student.class_id,
            action: "graduate",
          });
        } else if (nextClassName !== "STAYS IN CLASS (CUSTOM)") {
          let targetClass = classMap.get(nextClassName.toUpperCase());
          if (!targetClass) {
            targetClass = await ensureClassByName(nextClassName);
            if (targetClass) classMap.set(nextClassName.toUpperCase(), targetClass as ClassItem);
          }

          if (targetClass) {
            promotionsPayload.push({
              studentId: student.id,
              studentName: student.name,
              fromClassId: student.class_id,
              toClassId: targetClass.id,
              nextClassName,
              action: "promote",
            });
          }
        }
      }

      if (!promotionsPayload.length) {
        alert("No valid promotions to execute.");
        setProcessing(false);
        return;
      }

      const res = await fetch("/api/admin/promotions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promotions: promotionsPayload,
          currentSession,
          currentSessionId,
          nextSession: targetNextSession || currentSession,
          notes: notes.trim() || null,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.ok) {
        throw new Error(result.error || "Failed to execute promotions.");
      }

      alert(result.message || "Academic student promotions executed successfully!");
      setIsModalOpen(false);
      setNotes("");
      await loadData();
    } catch (err: any) {
      console.error("Promotion execution failed:", err);
      alert("Failed to promote: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="portal-header bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 shrink-0">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Class Promotions</h1>
            <p className="text-sm text-slate-500 mt-1">
              Promote students to the next class at the end of an academic session.
            </p>
          </div>
          <button
            onClick={handleOpenModal}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-sm shadow-sm transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Promote All Students
          </button>
        </header>

        <div className="portal-content p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full flex-1 space-y-8 overflow-y-auto">
          {/* Current session banner */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-1">
                Current Academic Session
              </div>
              <div className="text-2xl font-bold text-indigo-900">{currentSession}</div>
              <div className="text-sm text-indigo-600 mt-0.5">
                {currentTerm === "term3"
                  ? "3rd Term (End of Session — Promotion Ready)"
                  : `${currentTerm === "term1" ? "1st Term" : "2nd Term"} (Promotion usually at End of Session)`}
              </div>
            </div>
            <div className="text-sm text-indigo-700 bg-indigo-100 px-4 py-2 rounded-lg font-medium">
              Promotion moves students to their next class in this session.
            </div>
          </div>

          {/* Class Preview Table */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                Students by Class — Promotion Preview
              </h3>
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded font-semibold">
                {students.length} total students
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4">Current Class</th>
                    <th className="px-6 py-4">Students</th>
                    <th className="px-6 py-4">Will Be Promoted To</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                        Loading class data...
                      </td>
                    </tr>
                  ) : classList.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                        No classes found in schema.
                      </td>
                    </tr>
                  ) : (
                    classList.map((c) => {
                      const nextName = getNextClassLogical(c.name, jss3Track);
                      const count = studentCountMap.get(c.id) || 0;
                      let statusText = <span className="text-indigo-600 font-semibold">Ready to promote</span>;
                      if (count === 0) statusText = <span className="text-slate-400">Empty class</span>;
                      if (nextName === "STAYS IN CLASS (CUSTOM)") {
                        statusText = <span className="text-slate-400">Custom class (Ignored)</span>;
                      }

                      return (
                        <tr key={c.id} className="hover:bg-slate-50/50 border-b border-slate-100">
                          <td className="px-6 py-4 font-semibold text-slate-900">{c.name}</td>
                          <td className="px-6 py-4 font-medium text-slate-700">{count} students</td>
                          <td className="px-6 py-4 font-semibold text-indigo-700">{nextName}</td>
                          <td className="px-6 py-4">{statusText}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Promotion History */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Promotion History</h3>
            </div>
            <div className="divide-y divide-slate-100 p-4 space-y-3">
              {loading ? (
                <p className="text-sm text-slate-500 py-4 text-center">Loading history...</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">No past promotions logged yet.</p>
              ) : (
                history.map((h) => {
                  const count = Array.isArray(h.summary) ? h.summary.length : 0;
                  const date = new Date(h.promoted_at).toLocaleString();
                  return (
                    <div
                      key={h.id}
                      className="p-4 border border-slate-200 rounded-lg bg-slate-50/60 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                    >
                      <div>
                        <div className="text-sm font-bold text-slate-800">Session Completed: {h.session}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Promoted on {date} · Notes: {h.notes || "None"}
                        </div>
                      </div>
                      <div className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg shrink-0">
                        {count} students promoted / graduated
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        {/* Confirm Promote Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-slate-900">Confirm Class Promotion</h2>
              </div>
              <p className="text-sm text-slate-600">
                You are about to promote all eligible students to the next class. This action will:
              </p>
              <ul className="text-sm text-slate-600 space-y-1 list-disc pl-4">
                <li>
                  Move <strong>{eligibleCount}</strong> students to their next class
                </li>
                <li>Graduate SSS 3 students as Alumni</li>
                <li>Log this promotion event with timestamp</li>
                <li>All historical records (results, exams) remain untouched</li>
              </ul>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-xs">
                <strong>⚠ This cannot be undone.</strong> Make sure you have completed all result approvals before promoting.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Target Academic Session</label>
                  <input
                    type="text"
                    value={targetNextSession}
                    onChange={(e) => setTargetNextSession(e.target.value)}
                    placeholder="e.g. 2027/2028"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <p className="text-[11px] text-slate-400">Canonical format: YYYY/YYYY</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">JSS 3 Placement Track</label>
                  <select
                    value={jss3Track}
                    onChange={(e: any) => setJss3Track(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 bg-white"
                  >
                    <option value="Science">SSS 1 Science</option>
                    <option value="Arts">SSS 1 Arts</option>
                    <option value="Commercial">SSS 1 Commercial</option>
                  </select>
                  <p className="text-[11px] text-slate-400">Default track for JSS 3 graduates</p>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. End of academic session promotion"
                />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => setIsModalOpen(false)}
                  disabled={processing}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecutePromotion}
                  disabled={processing}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-sm shadow-sm transition-colors"
                >
                  {processing ? "Processing..." : "Promote Students"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
