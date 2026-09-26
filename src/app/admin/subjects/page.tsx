"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

interface CatalogueSubject {
  id: string;
  name: string;
  code: string;
  lists: string[];
  teachers: string[];
}

/** Short unique code for a new subject, e.g. "Basic Technology" → "BT", then "BT2" if taken. */
function makeSubjectCode(name: string, taken: Set<string>): string {
  const words = name.trim().toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const base = (words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] || "SUB").slice(0, 3)).slice(0, 6);
  let code = base;
  let n = 2;
  while (taken.has(code)) code = `${base}${n++}`;
  return code;
}

export default function AdminSubjectsPage() {
  const [subjects, setSubjects] = useState<CatalogueSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogueSubject | null>(null);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Teachers are shown for the current session only
      const { data: settings } = await supabase.from("app_settings").select("current_session_id").limit(1).maybeSingle();
      let assignQuery = supabase.from("subject_teacher_assignments").select("subject_id, teacher_user_id").eq("status", "active");
      if ((settings as any)?.current_session_id) assignQuery = assignQuery.eq("academic_session_id", (settings as any).current_session_id);

      const [subjectsRes, assignRes, usersRes, listRes, groupRes] = await Promise.all([
        supabase.from("subjects").select("id, name, code").order("name"),
        assignQuery,
        supabase.from("users").select("id, auth_id, display_name"),
        supabase.from("subject_group_subjects").select("group_code, subject_id"),
        supabase.from("subject_groups").select("code, name"),
      ]);
      if (subjectsRes.error) throw subjectsRes.error;

      const userName = new Map<string, string>();
      (usersRes.data || []).forEach((u: any) => {
        if (u.auth_id) userName.set(u.auth_id, u.display_name || "Teacher");
        if (u.id) userName.set(u.id, u.display_name || "Teacher");
      });
      const teachers = new Map<string, Set<string>>();
      (assignRes.data || []).forEach((a: any) => {
        if (!teachers.has(a.subject_id)) teachers.set(a.subject_id, new Set());
        teachers.get(a.subject_id)!.add(userName.get(a.teacher_user_id) || "Teacher");
      });
      const groupName = new Map((groupRes.data || []).map((g: any) => [g.code, g.name]));
      const lists = new Map<string, string[]>();
      (listRes.data || []).forEach((l: any) => {
        if (!lists.has(l.subject_id)) lists.set(l.subject_id, []);
        lists.get(l.subject_id)!.push(groupName.get(l.group_code) || l.group_code);
      });

      setSubjects(
        (subjectsRes.data || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          code: s.code,
          lists: lists.get(s.id) || [],
          teachers: Array.from(teachers.get(s.id) || []),
        }))
      );
    } catch (err: any) {
      setBanner({ type: "error", text: `Error loading subjects: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? subjects.filter((s) => s.name.toLowerCase().includes(q)) : subjects;
  }, [subjects, search]);

  function openModal(subject: CatalogueSubject | null) {
    setEditing(subject);
    setName(subject?.name || "");
    setFormError("");
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) return setFormError("Subject name is required.");
    if (subjects.some((s) => s.name.toLowerCase() === clean.toLowerCase() && s.id !== editing?.id)) {
      return setFormError(`A subject named "${clean}" already exists.`);
    }

    setSaving(true);
    setFormError("");
    try {
      if (editing) {
        const { error } = await supabase.from("subjects").update({ name: clean }).eq("id", editing.id);
        if (error) throw error;
        setBanner({ type: "success", text: `Renamed to "${clean}". Past results keep their scores.` });
      } else {
        const code = makeSubjectCode(clean, new Set(subjects.map((s) => s.code)));
        const { error } = await supabase.from("subjects").insert([{ name: clean, code, level: "both" }] as any);
        if (error) throw error;
        setBanner({ type: "success", text: `"${clean}" added. Add it to a class subject list so students take it.` });
      }
      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      setFormError(err.message || "Failed to save subject.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(subject: CatalogueSubject) {
    const warnings = [
      subject.lists.length ? `It is on these class lists: ${subject.lists.join(", ")}.` : "",
      subject.teachers.length ? `It is assigned to: ${subject.teachers.join(", ")}.` : "",
    ].filter(Boolean);
    if (!confirm(`Delete "${subject.name}"? ${warnings.join(" ")} All scores recorded for it will also be deleted.`)) return;

    const { error } = await supabase.from("subjects").delete().eq("id", subject.id);
    if (error) {
      setBanner({ type: "error", text: `Could not delete subject: ${error.message}` });
      return;
    }
    setBanner({ type: "success", text: `"${subject.name}" was deleted.` });
    loadData();
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Subject Catalogue</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Every subject the school teaches. Which classes take a subject is set on{" "}
            <Link href="/admin/subjects/lists" className="font-semibold text-indigo-600 hover:underline">
              Class Subject Lists
            </Link>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModal(null)}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer shrink-0"
        >
          + Add Subject
        </button>
      </div>

      {banner && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between ${
            banner.type === "error" ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer text-base leading-none" aria-label="Dismiss">
            &times;
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-3 border-b border-slate-100">
          <input
            type="text"
            placeholder="Search subjects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72 px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900 bg-slate-50/50"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Used by class lists</th>
                <th className="px-4 py-3">Teachers (this session)</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400">Loading subjects…</td>
                </tr>
              ) : displayed.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400">No subjects found.</td>
                </tr>
              ) : (
                displayed.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 text-sm">{s.name}</div>
                      <div className="text-[10px] font-mono text-slate-400">{s.code}</div>
                    </td>
                    <td className="px-4 py-3">
                      {s.lists.length ? (
                        <div className="flex flex-wrap gap-1">
                          {s.lists.map((l) => (
                            <span key={l} className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-[11px] font-medium">{l}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-amber-700 text-[11px]">Not on any list</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.teachers.length ? s.teachers.join(", ") : <span className="text-slate-400 italic">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button type="button" onClick={() => openModal(s)} className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                        Rename
                      </button>
                      <button type="button" onClick={() => handleDelete(s)} className="px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form onSubmit={handleSave} className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-sm w-full p-6 space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">{editing ? "Rename Subject" : "Add Subject"}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {editing ? "The new name appears on all reports." : "After adding, put it on a class subject list."}
              </p>
            </div>
            {formError && <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg">{formError}</div>}
            <input
              autoFocus
              type="text"
              placeholder="e.g. Basic Technology"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50">
                {saving ? "Saving…" : editing ? "Save" : "Add Subject"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
