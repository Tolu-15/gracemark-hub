"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { SubjectRecord } from "@/types/database";

interface SubjectWithStats extends SubjectRecord {
  assignedTeachers: string[];
  category: "Science" | "Arts" | "Commercial" | "Core & Vocational";
}

const STANDARD_CURRICULUM_SUBJECTS = [
  "Mathematics",
  "English Language",
  "Civic Education",
  "Computer Studies",
  "Social Studies",
  "Basic Science",
  "Basic Technology",
  "Physical & Health Education (PHE)",
  "Cultural & Creative Arts (CCA)",
  "Home Economics",
  "Business Studies",
  "Security Education",
  "Biology",
  "Chemistry",
  "Physics",
  "Further Mathematics",
  "Agricultural Science",
  "Technical Drawing",
  "Geography",
  "Food & Nutrition",
  "Literature in English",
  "Government",
  "History",
  "Christian Religious Studies",
  "Islamic Religious Studies",
  "Visual Arts",
  "Music",
  "French",
  "Yoruba",
  "Hausa",
  "Igbo",
  "Economics",
  "Commerce",
  "Financial Accounting",
  "Book Keeping",
  "Office Practice",
  "Marketing",
  "Store Management",
];

function categorizeSubject(name: string): "Science" | "Arts" | "Commercial" | "Core & Vocational" {
  const n = name.toLowerCase();
  if (
    n.includes("physic") ||
    n.includes("chem") ||
    n.includes("bio") ||
    n.includes("further math") ||
    n.includes("math") ||
    n.includes("basic sci") ||
    n.includes("tech") ||
    n.includes("geograph") ||
    n.includes("agric")
  ) {
    return "Science";
  }
  if (
    n.includes("econo") ||
    n.includes("commer") ||
    n.includes("account") ||
    n.includes("book") ||
    n.includes("office") ||
    n.includes("market") ||
    n.includes("store") ||
    n.includes("business")
  ) {
    return "Commercial";
  }
  if (
    n.includes("liter") ||
    n.includes("gov") ||
    n.includes("history") ||
    n.includes("religio") ||
    n.includes("christian") ||
    n.includes("islam") ||
    n.includes("crs") ||
    n.includes("irs") ||
    n.includes("art") ||
    n.includes("music")
  ) {
    return "Arts";
  }
  return "Core & Vocational";
}

export default function AdminSubjectsPage() {
  const [subjects, setSubjects] = useState<SubjectWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");

  // Add / Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SubjectRecord | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Status banners
  const [bannerMsg, setBannerMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: subjectsData, error: sErr }, { data: asgData, error: aErr }] =
        await Promise.all([
          supabase.from("subjects").select("*").order("name", { ascending: true }),
          supabase
            .from("teacher_assignments")
            .select("subject_id, teacher_user_id, users(display_name)"),
        ]);

      if (sErr) throw sErr;

      // Group teachers by subject_id
      const teacherMap = new Map<string, Set<string>>();
      (asgData || []).forEach((a: any) => {
        if (a.subject_id) {
          if (!teacherMap.has(a.subject_id)) {
            teacherMap.set(a.subject_id, new Set());
          }
          const teacherName = a.users?.display_name || "Teacher";
          teacherMap.get(a.subject_id)!.add(teacherName);
        }
      });

      const formatted: SubjectWithStats[] = (subjectsData || []).map((s) => ({
        ...s,
        assignedTeachers: Array.from(teacherMap.get(s.id) || []),
        category: categorizeSubject(s.name),
      }));

      setSubjects(formatted);
    } catch (err: any) {
      console.error("Failed to load subjects:", err);
      setBannerMsg({ type: "error", text: `Error loading subjects: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleOpenAdd() {
    setEditingSubject(null);
    setSubjectName("");
    setFormError("");
    setIsModalOpen(true);
  }

  function handleOpenEdit(subj: SubjectRecord) {
    setEditingSubject(subj);
    setSubjectName(subj.name);
    setFormError("");
    setIsModalOpen(true);
  }

  async function handleSaveSubject(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = subjectName.trim();
    if (!cleanName) {
      setFormError("Subject name is required.");
      return;
    }

    // Check duplicate locally
    const duplicate = subjects.find(
      (s) =>
        s.name.trim().toLowerCase() === cleanName.toLowerCase() &&
        (!editingSubject || s.id !== editingSubject.id)
    );
    if (duplicate) {
      setFormError(`A subject named "${cleanName}" already exists.`);
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      if (editingSubject) {
        const { error } = await supabase
          .from("subjects")
          .update({ name: cleanName })
          .eq("id", editingSubject.id);
        if (error) throw error;
        setBannerMsg({ type: "success", text: `Subject updated to "${cleanName}"!` });
      } else {
        const { error } = await supabase.from("subjects").insert([{ name: cleanName }]);
        if (error) throw error;
        setBannerMsg({ type: "success", text: `Subject "${cleanName}" created successfully!` });
      }

      setIsModalOpen(false);
      loadData();
      setTimeout(() => setBannerMsg(null), 5000);
    } catch (err: any) {
      console.error("Save subject error:", err);
      setFormError(err.message || "Failed to save subject.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSubject(subj: SubjectWithStats) {
    if (subj.assignedTeachers.length > 0) {
      const confirmForce = confirm(
        `Subject "${subj.name}" is currently assigned to ${subj.assignedTeachers.length} teacher(s) (${subj.assignedTeachers.join(", ")}). Deleting it will remove these assignments. Are you sure you want to proceed?`
      );
      if (!confirmForce) return;
    } else {
      if (!confirm(`Are you sure you want to delete "${subj.name}"?`)) return;
    }

    try {
      const { error } = await supabase.from("subjects").delete().eq("id", subj.id);
      if (error) throw error;
      setBannerMsg({ type: "success", text: `Subject "${subj.name}" was deleted.` });
      loadData();
      setTimeout(() => setBannerMsg(null), 5000);
    } catch (err: any) {
      console.error("Delete subject error:", err);
      alert(`Could not delete subject: ${err.message}`);
    }
  }

  async function handleBulkAddStandardCurriculum() {
    const existingNames = new Set(subjects.map((s) => s.name.trim().toLowerCase()));
    const missing = STANDARD_CURRICULUM_SUBJECTS.filter(
      (name) => !existingNames.has(name.trim().toLowerCase())
    );

    if (missing.length === 0) {
      alert("All standard curriculum subjects are already in the database!");
      return;
    }

    if (!confirm(`This will add ${missing.length} missing curriculum subjects. Proceed?`)) {
      return;
    }

    try {
      const toInsert = missing.map((name) => ({ name }));
      const { error } = await supabase.from("subjects").insert(toInsert);
      if (error) throw error;

      setBannerMsg({
        type: "success",
        text: `Successfully added ${missing.length} standard curriculum subjects!`,
      });
      loadData();
      setTimeout(() => setBannerMsg(null), 6000);
    } catch (err: any) {
      console.error("Error bulk adding standard curriculum:", err);
      alert(`Failed to add standard curriculum: ${err.message}`);
    }
  }

  const filteredSubjects = subjects.filter((s) => {
    if (activeCategory !== "All" && s.category !== activeCategory) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return s.name.toLowerCase().includes(q);
    }
    return true;
  });

  const categoryCounts = {
    All: subjects.length,
    Science: subjects.filter((s) => s.category === "Science").length,
    Arts: subjects.filter((s) => s.category === "Arts").length,
    Commercial: subjects.filter((s) => s.category === "Commercial").length,
    "Core & Vocational": subjects.filter((s) => s.category === "Core & Vocational").length,
  };

  const assignedCount = subjects.filter((s) => s.assignedTeachers.length > 0).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header bar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </span>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Subject Curriculum Management
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Configure academic subjects, inspect teacher delegations, and maintain official school curriculum rosters.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleBulkAddStandardCurriculum}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Populate missing standard WAEC/NECO curriculum subjects"
          >
            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span>Standard Curriculum</span>
          </button>

          <button
            type="button"
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            <span>Add Subject</span>
          </button>
        </div>
      </div>

      {/* Banner */}
      {bannerMsg && (
        <div
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between ${
            bannerMsg.type === "error"
              ? "bg-rose-50 text-rose-700 border border-rose-200"
              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          <span>{bannerMsg.text}</span>
          <button
            onClick={() => setBannerMsg(null)}
            className="text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            &times;
          </button>
        </div>
      )}

      {/* Stats summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Subjects</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{subjects.length}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Across all secondary levels</p>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">Assigned to Teachers</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{assignedCount}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Active in school schedule</p>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">Science Stream</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{categoryCounts.Science}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Core science & math</p>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600">Commercial & Arts</p>
          <p className="text-2xl font-black text-slate-900 mt-1">
            {categoryCounts.Commercial + categoryCounts.Arts}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Humanities & business</p>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          {(["All", "Science", "Arts", "Commercial", "Core & Vocational"] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeCategory === cat
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {cat} ({categoryCounts[cat]})
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <svg
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search subjects…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9.5 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 bg-slate-50/50"
          />
        </div>
      </div>

      {/* Subjects Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3.5">Subject Name</th>
                <th className="px-4 py-3.5">Category</th>
                <th className="px-4 py-3.5">Assigned Teachers</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                    Loading subject curriculum…
                  </td>
                </tr>
              ) : filteredSubjects.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                    No subjects found matching your search.
                  </td>
                </tr>
              ) : (
                filteredSubjects.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-3.5 font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                        <span>{s.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                          s.category === "Science"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : s.category === "Commercial"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : s.category === "Arts"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-purple-50 text-purple-700 border border-purple-200"
                        }`}
                      >
                        {s.category}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {s.assignedTeachers.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {s.assignedTeachers.map((t, i) => (
                            <span
                              key={i}
                              className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-medium"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(s)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSubject(s)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              {editingSubject ? "Edit Subject" : "Add New Academic Subject"}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              {editingSubject
                ? "Modify the registered subject title."
                : "Enter the name of the subject to add it to the curriculum."}
            </p>

            {formError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveSubject} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Subject Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Further Mathematics, Arabic, Music"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 bg-slate-50/50"
                />
              </div>

              {!editingSubject && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                    Quick Add Suggestions:
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {STANDARD_CURRICULUM_SUBJECTS.filter(
                      (n) => !subjects.some((s) => s.name.toLowerCase() === n.toLowerCase())
                    )
                      .slice(0, 8)
                      .map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setSubjectName(preset)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold rounded-lg transition-colors cursor-pointer"
                        >
                          + {preset}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {saving ? "Saving…" : editingSubject ? "Save Changes" : "Create Subject"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
