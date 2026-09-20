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
}

export default function TeacherRemarksPage() {
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [term, setTerm] = useState("term1");
  const [session, setSession] = useState("");

  const [rows, setRows] = useState<EvaluationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Ready to save. Ratings are on a 1 (low) to 5 (high) scale.");
  const [teacherId, setTeacherId] = useState<string | null>(null);

  // 1. Initial Load: Teacher Profile & Assigned Classes
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

      const teacherUid = profile?.id || user.id;
      setTeacherId(teacherUid);

      const settings = await getAppSettings();
      const curSess = settings?.current_session || settings?.active_session;
      if (curSess) setSession(curSess);
      const curTerm = settings?.current_term || settings?.active_term;
      if (curTerm) setTerm(curTerm);

      // Fetch teacher assignments across all assignment sources
      const idList = Array.from(new Set([teacherUid, user.id].filter(Boolean)));
      const uniqueClassesMap = new Map<string, ClassRecord>();

      // 1. class_teacher_assignments
      try {
        const { data: cta } = await supabase
          .from("class_teacher_assignments")
          .select("class_id, classes(id, name)")
          .in("teacher_user_id", idList)
          .eq("status", "active");
        (cta || []).forEach((a: any) => {
          if (a.classes?.id && a.classes?.name) uniqueClassesMap.set(a.classes.id, a.classes);
        });
      } catch (e) {
        console.warn("CTA lookup failed:", e);
      }

      // 2. classes where class_teacher_id matches
      try {
        const { data: ctClasses } = await supabase
          .from("classes")
          .select("id, name")
          .in("class_teacher_id", idList);
        (ctClasses || []).forEach((c: any) => {
          if (c?.id && c?.name) uniqueClassesMap.set(c.id, c);
        });
      } catch (e) {
        console.warn("classes.class_teacher_id lookup failed:", e);
      }

      // 3. subject_teacher_assignments
      try {
        const { data: subAssigns } = await supabase
          .from("subject_teacher_assignments")
          .select("class_id, classes(id, name)")
          .in("teacher_user_id", idList)
          .eq("status", "active");
        (subAssigns || []).forEach((a: any) => {
          if (a.classes?.id && a.classes?.name) uniqueClassesMap.set(a.classes.id, a.classes);
        });
      } catch (e) {
        // table not ready yet
      }

      // 4. legacy teacher_assignments
      try {
        const { data: assignments } = await supabase
          .from("teacher_assignments")
          .select("class_id, classes(id, name)")
          .in("teacher_user_id", idList);

        (assignments || []).forEach((asg: any) => {
          if (asg.classes?.id && asg.classes?.name) {
            uniqueClassesMap.set(asg.classes.id, asg.classes);
          }
        });
      } catch (e) {
        // fallback
      }

      const classList = Array.from(uniqueClassesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
      setClasses(classList);
      if (classList.length > 0) {
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
          };
        });

        setRows(newRows);
      } catch (err: any) {
        console.error("Load error:", err);
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

  const saveEvaluations = async () => {
    if (!selectedClass || !term) return;
    setSaving(true);
    setSaveStatus("Saving student evaluations...");

    const supabase = getSupabaseBrowserClient();
    const payload = rows.map((r) => ({
      student_id: r.student_id,
      term,
      session,
      submitted_by: teacherId,
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
      updated_at: new Date().toISOString(),
    }));

    try {
      const { error } = await supabase
        .from("student_evaluations")
        .upsert(payload, { onConflict: "student_id,term,session" });

      if (error) throw error;

      setSaveStatus("Evaluations saved successfully!");
      setTimeout(() => {
        setSaveStatus("Ready to save. Ratings are on a 1 (low) to 5 (high) scale.");
      }, 4000);
    } catch (err: any) {
      console.error("Save error:", err);
      setSaveStatus(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Remarks &amp; Evaluations</h1>
          <p className="text-sm text-slate-500 mt-1">
            Grade student behavioral traits, psychomotor skills, and write terminal reports remarks.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Class</label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full min-w-[8rem] px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 bg-white"
            >
              {classes.length === 0 ? (
                <option value="">No classes assigned</option>
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
              className="w-full min-w-[7rem] px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 bg-white"
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-8 text-center text-slate-500">
                      Loading students and evaluations...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-8 text-center text-slate-500">
                      {classes.length === 0 ? "No classes assigned to you." : "No students found in this class."}
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
                            className="px-1.5 py-1 border border-slate-300 rounded text-xs bg-white focus:border-indigo-500 focus:outline-none"
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
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-lg text-sm shadow-sm transition-colors"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
