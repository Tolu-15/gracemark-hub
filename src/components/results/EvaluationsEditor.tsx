"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";
import { PERSONAL_SKILLS } from "@/lib/gradingEngine";

interface Row {
  id: string;
  name: string;
  admission_no: string;
  skills: Record<string, number | "">;
  teacher_remark: string;
  principal_remark: string;
}

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

const REMARK_SUGGESTIONS = [
  "A hardworking and well-behaved student.",
  "Brilliant and attentive in class. Keep it up.",
  "Has improved this term; should keep working hard.",
  "Capable of better results with more effort.",
  "Needs to be more punctual and attentive in class.",
];

/**
 * Personal skills (1–5) and remarks for the terminal result.
 * Admins can also override the principal's remark (blank = automatic).
 */
export default function EvaluationsEditor({
  classes,
  initialTerm,
  isAdmin,
}: {
  classes: { id: string; name: string }[];
  initialTerm: string;
  isAdmin: boolean;
}) {
  const [classId, setClassId] = useState(classes[0]?.id || "");
  const [term, setTerm] = useState(initialTerm || "term1");
  const [rows, setRows] = useState<Row[]>([]);
  const [session, setSession] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!classId && classes[0]) setClassId(classes[0].id);
  }, [classes, classId]);

  useEffect(() => {
    if (initialTerm) setTerm(initialTerm);
  }, [initialTerm]);

  const load = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/results/evaluations?class_id=${classId}&term=${term}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load students.");
      setSession(json.session);
      setRows(json.students);
      setDirty(false);
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [classId, term]);

  useEffect(() => {
    load();
  }, [load]);

  function update(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function setSkill(index: number, key: string, value: string) {
    const n = value === "" ? "" : Math.max(1, Math.min(5, Math.round(Number(value))));
    update(index, { skills: { ...rows[index].skills, [key]: Number.isFinite(n as number) || n === "" ? n : "" } });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/results/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({
          class_id: classId,
          term,
          rows: rows.map((r) => ({ student_id: r.id, skills: r.skills, teacher_remark: r.teacher_remark, principal_remark: r.principal_remark })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Save failed.");
      setDirty(false);
      setMessage({ type: "ok", text: `Saved for ${json.saved} students.` });
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  }

  const complete = rows.filter((r) => r.teacher_remark && PERSONAL_SKILLS.every((k) => r.skills[k.key] !== undefined && r.skills[k.key] !== "")).length;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Personal Skills &amp; Remarks</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Rate each skill from 1 (low) to 5 (high) and write the class teacher&rsquo;s remark. These appear on the terminal result.
            {session ? ` Session ${session}.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Class
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="mt-1 block w-44 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal">
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Term
            <select value={term} onChange={(e) => setTerm(e.target.value)} className="mt-1 block w-32 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal">
              {TERMS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
          >
            {saving ? "Saving…" : "Save all"}
          </button>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-xl text-xs font-semibold border ${message.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-700"}`}>
          {message.text}
        </div>
      )}

      {classes.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-500 bg-white rounded-2xl border border-slate-200">You are not assigned to any class.</div>
      ) : (
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs text-slate-500">
            {complete} of {rows.length} students complete{dirty ? " · unsaved changes" : ""}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[1100px]">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left sticky left-0 bg-slate-50 z-10 w-44">Student</th>
                  {PERSONAL_SKILLS.map((k) => (
                    <th key={k.key} className="px-1 py-2 text-center w-12" title={k.label}>
                      <span className="block leading-tight">{k.label.replace(" in Class", "").replace(" Skills", "").replace(" Skill", "")}</span>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center">Total</th>
                  <th className="px-3 py-2 text-left min-w-[220px]">Class teacher&rsquo;s remark</th>
                  {isAdmin && <th className="px-3 py-2 text-left min-w-[200px]">Principal&rsquo;s remark (optional)</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={16} className="px-4 py-10 text-center text-slate-400">Loading…</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="px-4 py-10 text-center text-slate-400">No students in this class.</td>
                  </tr>
                ) : (
                  rows.map((r, i) => {
                    const total = PERSONAL_SKILLS.reduce((s, k) => s + (Number(r.skills[k.key]) || 0), 0);
                    return (
                      <tr key={r.id}>
                        <td className="px-3 py-1.5 sticky left-0 bg-white z-10">
                          <div className="font-semibold text-slate-900 truncate max-w-[170px]">{r.name}</div>
                          <div className="text-[10px] font-mono text-slate-400">{r.admission_no}</div>
                        </td>
                        {PERSONAL_SKILLS.map((k) => (
                          <td key={k.key} className="px-1 py-1.5 text-center">
                            <input
                              type="number"
                              min={1}
                              max={5}
                              value={r.skills[k.key] ?? ""}
                              onChange={(e) => setSkill(i, k.key, e.target.value)}
                              aria-label={`${k.label} for ${r.name}`}
                              className="w-10 h-7 text-center border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-center font-bold tabular-nums">{total || "—"}</td>
                        <td className="px-3 py-1.5">
                          <input
                            list="remark-suggestions"
                            value={r.teacher_remark}
                            onChange={(e) => update(i, { teacher_remark: e.target.value })}
                            placeholder="Type or pick a remark"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
                          />
                        </td>
                        {isAdmin && (
                          <td className="px-3 py-1.5">
                            <input
                              value={r.principal_remark}
                              onChange={(e) => update(i, { principal_remark: e.target.value })}
                              placeholder="Automatic"
                              className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <datalist id="remark-suggestions">
              {REMARK_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>
      )}
    </div>
  );
}
