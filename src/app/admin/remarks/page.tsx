"use client";

import React, { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import { ClassRecord, StudentEvaluation } from "@/types/database";

interface EvaluationRow {
  student_id: string;
  name: string;
  admission_no: string;
  punctuality: number | "";
  neatness: number | "";
  honesty: number | "";
  politeness: number | "";
  cooperation: number | "";
  leadership: number | "";
  handwriting: number | "";
  sports: number | "";
  crafts: number | "";
  music: number | "";
  teacher_remark: string;
  principal_remark: string;
}

export default function AdminRemarksPage() {
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [term, setTerm] = useState("term1");
  const [session, setSession] = useState("2025/2026");

  const [rows, setRows] = useState<EvaluationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(
    "Ratings are on a 1 (low) to 5 (high) scale. Admins can update remarks for all students."
  );
  const [adminUserId, setAdminUserId] = useState<string | null>(null);

  // 1. Initial Load: Admin Profile & All Classes
  useEffect(() => {
    async function init() {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("users")
        .select("id")
        .eq("auth_id", user.id)
        .maybeSingle();

      setAdminUserId(profile?.id || user.id);

      const settings = await getAppSettings();
      if (settings?.current_session) setSession(settings.current_session);
      if (settings?.current_term) setTerm(settings.current_term);

      // Fetch all classes
      const { data: classList, error } = await supabase
        .from("classes")
        .select("id, name")
        .order("name", { ascending: true });

      if (error) {
        console.error("Error fetching classes:", error);
        return;
      }

      setClasses(classList || []);
      if (classList && classList.length > 0) {
        setSelectedClass(classList[0].id);
      }
    }
    init();
  }, []);

  // 2. Load Students and Existing Evaluations
  useEffect(() => {
    if (!selectedClass || !term) return;

    async function loadData() {
      setLoading(true);
      const supabase = getSupabaseBrowserClient();

      try {
        const { data: students, error: stdErr } = await supabase
          .from("students")
          .select("id, name, admission_no")
          .eq("class_id", selectedClass)
          .eq("is_alumni", false)
          .order("name", { ascending: true });

        if (stdErr) throw stdErr;

        const studentList = students || [];
        const studentIds = studentList.map((s) => s.id);

        const evalsMap = new Map<string, StudentEvaluation>();
        if (studentIds.length > 0) {
          const { data: evals, error: evErr } = await supabase
            .from("student_evaluations")
            .select("*")
            .in("student_id", studentIds)
            .eq("term", term)
            .eq("session", session);

          if (evErr) throw evErr;
          (evals || []).forEach((ev: StudentEvaluation) => {
            evalsMap.set(ev.student_id, ev);
          });
        }

        const newRows: EvaluationRow[] = studentList.map((s) => {
          const ev = evalsMap.get(s.id);
          return {
            student_id: s.id,
            name: s.name,
            admission_no: s.admission_no,
            punctuality: ev?.punctuality ?? "",
            neatness: ev?.neatness ?? "",
            honesty: ev?.honesty ?? "",
            politeness: ev?.politeness ?? "",
            cooperation: ev?.cooperation ?? "",
            leadership: ev?.leadership ?? "",
            handwriting: ev?.handwriting ?? "",
            sports: ev?.sports ?? "",
            crafts: ev?.crafts ?? "",
            music: ev?.music ?? "",
            teacher_remark: ev?.teacher_remark || "",
            principal_remark: ev?.principal_remark || "",
          };
        });

        setRows(newRows);
      } catch (err: any) {
        console.error("Admin load error:", err);
        setSaveStatus(`Error loading data: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [selectedClass, term, session]);

  const handleTraitChange = (index: number, field: keyof EvaluationRow, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: value === "" ? "" : Number(value),
      };
      return next;
    });
  };

  const handleRemarkChange = (index: number, field: "teacher_remark" | "principal_remark", value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: value,
      };
      return next;
    });
  };

  const saveEvaluations = async () => {
    if (!selectedClass || !term) return;
    setSaving(true);
    setSaveStatus("Saving student evaluations...");

    const supabase = getSupabaseBrowserClient();
    const payload = rows.map((r) => ({
      student_id: r.student_id,
      term,
      session,
      submitted_by: adminUserId,
      punctuality: r.punctuality === "" ? null : Number(r.punctuality),
      neatness: r.neatness === "" ? null : Number(r.neatness),
      honesty: r.honesty === "" ? null : Number(r.honesty),
      politeness: r.politeness === "" ? null : Number(r.politeness),
      cooperation: r.cooperation === "" ? null : Number(r.cooperation),
      leadership: r.leadership === "" ? null : Number(r.leadership),
      handwriting: r.handwriting === "" ? null : Number(r.handwriting),
      sports: r.sports === "" ? null : Number(r.sports),
      crafts: r.crafts === "" ? null : Number(r.crafts),
      music: r.music === "" ? null : Number(r.music),
      teacher_remark: r.teacher_remark.trim() || null,
      principal_remark: r.principal_remark.trim() || null,
      updated_at: new Date().toISOString(),
    }));

    try {
      const { error } = await supabase
        .from("student_evaluations")
        .upsert(payload, { onConflict: "student_id,term,session" });

      if (error) throw error;

      setSaveStatus("Evaluations saved successfully!");
      setTimeout(() => {
        setSaveStatus("Ratings are on a 1 (low) to 5 (high) scale. Admins can update remarks for all students.");
      }, 4000);
    } catch (err: any) {
      console.error("Admin save error:", err);
      setSaveStatus(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Admin Remarks &amp; Evaluations</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage affective traits, psychomotor skills, teacher remarks, and principal remarks for any student in any class.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Select Class</label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full min-w-[9rem] px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
            >
              {classes.length === 0 ? (
                <option value="">No classes configured</option>
              ) : (
                classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Term</label>
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="w-full min-w-[7rem] px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
            >
              <option value="term1">1st Term</option>
              <option value="term2">2nd Term</option>
              <option value="term3">3rd Term</option>
            </select>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full flex-1">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-4 sticky left-0 bg-slate-50 border-r border-slate-200 z-10">Student</th>
                  <th className="px-2 py-4 text-center">Punc</th>
                  <th className="px-2 py-4 text-center">Neat</th>
                  <th className="px-2 py-4 text-center">Hnst</th>
                  <th className="px-2 py-4 text-center">Plt</th>
                  <th className="px-2 py-4 text-center">Coop</th>
                  <th className="px-2 py-4 text-center">Ldr</th>
                  <th className="px-2 py-4 text-center">Hndw</th>
                  <th className="px-2 py-4 text-center">Sprt</th>
                  <th className="px-2 py-4 text-center">Crft</th>
                  <th className="px-2 py-4 text-center">Musc</th>
                  <th className="px-4 py-4 min-w-[200px]">Form Teacher's Remark</th>
                  <th className="px-4 py-4 min-w-[200px]">Principal's Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={13} className="px-6 py-8 text-center text-slate-500">
                      Loading class evaluation records...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-6 py-8 text-center text-slate-500">
                      {classes.length === 0 ? "No classes configured." : "No active students found in this class."}
                    </td>
                  </tr>
                ) : (
                  rows.map((r, idx) => (
                    <tr key={r.student_id} className="hover:bg-slate-50/50 border-b border-slate-100">
                      <td className="px-4 py-4 sticky left-0 bg-white border-r border-slate-100 font-medium text-slate-900 z-10">
                        <div className="leading-tight">
                          <div>{r.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{r.admission_no}</div>
                        </div>
                      </td>
                      {(["punctuality", "neatness", "honesty", "politeness", "cooperation", "leadership", "handwriting", "sports", "crafts", "music"] as const).map((trait) => (
                        <td key={trait} className="px-1 py-3 text-center">
                          <select
                            value={r[trait]}
                            onChange={(e) => handleTraitChange(idx, trait, e.target.value)}
                            className="px-1.5 py-1 border border-slate-300 rounded text-xs bg-white focus:border-blue-500 focus:outline-none"
                          >
                            <option value="">—</option>
                            {[1, 2, 3, 4, 5].map((val) => (
                              <option key={val} value={val}>
                                {val}
                              </option>
                            ))}
                          </select>
                        </td>
                      ))}
                      <td className="px-2 py-3">
                        <input
                          type="text"
                          value={r.teacher_remark}
                          onChange={(e) => handleRemarkChange(idx, "teacher_remark", e.target.value)}
                          className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                          placeholder="Form teacher remark..."
                        />
                      </td>
                      <td className="px-2 py-3">
                        <input
                          type="text"
                          value={r.principal_remark}
                          onChange={(e) => handleRemarkChange(idx, "principal_remark", e.target.value)}
                          className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                          placeholder="Principal remark..."
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap justify-between items-center gap-3 mt-6">
          <div className="text-sm font-medium text-slate-500">{saveStatus}</div>
          <button
            onClick={saveEvaluations}
            disabled={saving || loading || rows.length === 0}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg text-sm shadow-sm transition-colors"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
