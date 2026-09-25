"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/supabase/client";

interface Group {
  code: string;
  name: string;
  level: string;
}
interface Subject {
  id: string;
  name: string;
  level: string;
}
interface ClassRow {
  id: string;
  name: string;
  subject_group_code: string | null;
}
interface ListItem {
  subject_id: string;
  credit_unit: number | "";
  frequency: "weekly" | "fortnightly";
}

export default function ClassSubjectListsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [lists, setLists] = useState<Record<string, ListItem[]>>({});
  const [savedLists, setSavedLists] = useState<Record<string, ListItem[]>>({});
  const [active, setActive] = useState("");
  const [addId, setAddId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/subject-groups", { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load subject lists.");

      const byGroup: Record<string, ListItem[]> = {};
      (json.groups as Group[]).forEach((g) => (byGroup[g.code] = []));
      (json.items as any[]).forEach((i) => {
        (byGroup[i.group_code] ||= []).push({
          subject_id: i.subject_id,
          credit_unit: Number(i.credit_unit),
          frequency: i.frequency === "weekly" ? "weekly" : "fortnightly",
        });
      });

      setGroups(json.groups);
      setSubjects(json.subjects);
      setClasses(json.classes);
      setLists(byGroup);
      setSavedLists(JSON.parse(JSON.stringify(byGroup)));
      setActive((prev) => prev || json.groups[0]?.code || "");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const subjectName = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);
  const current = lists[active] || [];
  const dirty = JSON.stringify(current) !== JSON.stringify(savedLists[active] || []);
  const totalUnits = current.reduce((s, i) => s + (Number(i.credit_unit) || 0), 0);
  const available = subjects.filter((s) => !current.some((i) => i.subject_id === s.id));
  const groupClasses = classes.filter((c) => c.subject_group_code === active);
  const unassignedClasses = classes.filter((c) => !c.subject_group_code);

  function updateCurrent(next: ListItem[]) {
    setLists((prev) => ({ ...prev, [active]: next }));
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...current];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateCurrent(next);
  }

  function sortAlphabetically() {
    updateCurrent([...current].sort((a, b) => (subjectName.get(a.subject_id) || "").localeCompare(subjectName.get(b.subject_id) || "")));
  }

  async function save() {
    if (current.some((i) => i.credit_unit === "")) {
      setError("Every subject needs a credit unit (use 0 to leave a subject out of GPA).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/subject-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ action: "save-group", group_code: active, items: current }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Save failed.");
      setSavedLists((prev) => ({ ...prev, [active]: JSON.parse(JSON.stringify(current)) }));
      setNotice("Subject list saved. Students in these classes now take exactly these subjects.");
      setTimeout(() => setNotice(null), 4000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function setClassGroup(classId: string, groupCode: string | null) {
    setError(null);
    const res = await fetch("/api/admin/subject-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
      body: JSON.stringify({ action: "set-class-group", class_id: classId, group_code: groupCode }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json.error || "Could not update the class.");
      return;
    }
    setClasses((prev) => prev.map((c) => (c.id === classId ? { ...c, subject_group_code: groupCode } : c)));
  }

  if (loading) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading subject lists…</div>;
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Class Subject Lists</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Each class uses one list. Students take every subject on their class list; a subject teacher can mark a
            student &ldquo;Not offering&rdquo; in score entry.
          </p>
        </div>
        <Link href="/admin/subjects" className="text-xs font-semibold text-indigo-600 hover:underline shrink-0">
          Subject catalogue →
        </Link>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>
      )}
      {notice && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">{notice}</div>
      )}

      {groups.length > 0 && (
        <>
          {/* Group tabs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {groups.map((g) => {
              const count = (lists[g.code] || []).length;
              const isActive = g.code === active;
              const unsaved = JSON.stringify(lists[g.code] || []) !== JSON.stringify(savedLists[g.code] || []);
              return (
                <button
                  key={g.code}
                  type="button"
                  onClick={() => {
                    setActive(g.code);
                    setAddId("");
                  }}
                  className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                    isActive ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 hover:border-slate-400 text-slate-800"
                  }`}
                >
                  <div className="text-sm font-bold">{g.name}</div>
                  <div className={`text-[11px] mt-0.5 ${isActive ? "text-slate-300" : "text-slate-500"}`}>
                    {count} subjects{unsaved ? " · unsaved" : ""}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Subjects in the active list */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-slate-100">
              <div className="text-xs text-slate-500">
                Used by:{" "}
                {groupClasses.length ? (
                  <span className="font-semibold text-slate-800">{groupClasses.map((c) => c.name).join(", ")}</span>
                ) : (
                  <span className="italic">no class yet</span>
                )}
              </div>
              <button
                type="button"
                onClick={sortAlphabetically}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Sort A–Z
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-left">
                  <th className="px-4 py-2.5 w-10">#</th>
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-4 py-2.5 w-32">Credit unit</th>
                  <th className="px-4 py-2.5 w-44" title="How often classwork and homework are given">Classwork &amp; homework</th>
                  <th className="px-4 py-2.5 w-36 text-right">Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {current.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400 text-xs">
                      No subjects in this list yet. Add one below.
                    </td>
                  </tr>
                ) : (
                  current.map((item, index) => (
                    <tr key={item.subject_id}>
                      <td className="px-4 py-2 text-xs text-slate-400">{index + 1}</td>
                      <td className="px-4 py-2 font-semibold text-slate-900">{subjectName.get(item.subject_id) || "Unknown subject"}</td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={0}
                          max={20}
                          step={0.5}
                          value={item.credit_unit}
                          onChange={(e) => {
                            const next = [...current];
                            next[index] = { ...item, credit_unit: e.target.value === "" ? "" : Number(e.target.value) };
                            updateCurrent(next);
                          }}
                          className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-sm font-semibold text-center focus:outline-none focus:ring-1 focus:ring-slate-900"
                          aria-label={`Credit unit for ${subjectName.get(item.subject_id)}`}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={item.frequency}
                          onChange={(e) => {
                            const next = [...current];
                            next[index] = { ...item, frequency: e.target.value === "weekly" ? "weekly" : "fortnightly" };
                            updateCurrent(next);
                          }}
                          className="px-2 py-1 border border-slate-300 rounded-lg text-xs font-semibold bg-white"
                          aria-label={`How often for ${subjectName.get(item.subject_id)}`}
                        >
                          <option value="fortnightly">Every 2 weeks (5)</option>
                          <option value="weekly">Weekly (10)</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="px-2 py-1 text-xs rounded-md hover:bg-slate-100 disabled:opacity-30 cursor-pointer" aria-label="Move up">↑</button>
                          <button type="button" onClick={() => move(index, 1)} disabled={index === current.length - 1} className="px-2 py-1 text-xs rounded-md hover:bg-slate-100 disabled:opacity-30 cursor-pointer" aria-label="Move down">↓</button>
                          <button
                            type="button"
                            onClick={() => updateCurrent(current.filter((i) => i.subject_id !== item.subject_id))}
                            className="px-2 py-1 text-xs font-semibold text-rose-600 rounded-md hover:bg-rose-50 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-slate-100 bg-slate-50/60">
              <div className="flex items-center gap-2">
                <select
                  value={addId}
                  onChange={(e) => setAddId(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800"
                >
                  <option value="">Add a subject…</option>
                  {available.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!addId}
                  onClick={() => {
                    updateCurrent([...current, { subject_id: addId, credit_unit: 1, frequency: "fortnightly" }]);
                    setAddId("");
                  }}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                >
                  Add
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">
                  Total units: <strong className="text-slate-800">{totalUnits}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => updateCurrent(JSON.parse(JSON.stringify(savedLists[active] || [])))}
                  disabled={!dirty || saving}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40 cursor-pointer"
                >
                  Undo changes
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty || saving}
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
                >
                  {saving ? "Saving…" : "Save list"}
                </button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 px-1">
            GPA = Σ(score × credit unit) ÷ (student&rsquo;s own units × 20), so it is always out of 5. A credit unit of 0 keeps
            the subject on the report but leaves it out of GPA. &ldquo;Every 2 weeks&rdquo; means classwork and homework in weeks 2, 4, 6,
            8 and 10; teachers only see those weeks, and a blank score counts as 0.
          </p>

          {/* Class → list mapping */}
          <details className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs" open={unassignedClasses.length > 0}>
            <summary className="text-sm font-bold text-slate-900 cursor-pointer">
              Classes linked to each list{" "}
              <span className="font-normal text-xs text-slate-500">
                {unassignedClasses.length ? `(${unassignedClasses.length} class not linked)` : "(already set up)"}
              </span>
            </summary>
            <p className="text-xs text-slate-500 mt-2 mb-3">
              Each class takes the subjects on the list chosen here, e.g. SSS 2 Science takes the SSS Science list. You only need this when you
              add a new class. To move a student from Arts to Science, change the student&rsquo;s class on Manage Students.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {classes.map((c) => (
                <label key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 text-xs">
                  <span className="font-semibold text-slate-800">{c.name}</span>
                  <select
                    value={c.subject_group_code || ""}
                    onChange={(e) => setClassGroup(c.id, e.target.value || null)}
                    className={`px-2 py-1 border rounded-md text-xs ${c.subject_group_code ? "border-slate-300" : "border-amber-400 bg-amber-50"}`}
                  >
                    <option value="">— none —</option>
                    {groups.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {unassignedClasses.length > 0 && (
              <p className="text-[11px] text-amber-700 mt-2">
                {unassignedClasses.length} class(es) have no subject list, so their students have no subjects.
              </p>
            )}
          </details>
        </>
      )}
    </div>
  );
}
