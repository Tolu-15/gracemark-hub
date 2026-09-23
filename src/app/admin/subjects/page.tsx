"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase/client";
import { SubjectRecord } from "@/types/database";
import {
  STANDARD_JSS_SUBJECTS,
  STANDARD_SSS_SUBJECTS,
  JSS_SUBJECT_PERIODS,
  SSS_SUBJECT_PERIODS,
  SubjectLevel,
  getSubjectLevel,
  getSubjectPeriods,
} from "@/lib/curriculum";

interface SubjectWithStats extends SubjectRecord {
  assignedTeachers: string[];
  level: SubjectLevel;
  periods?: number | null;
  category: "Science" | "Arts" | "Commercial" | "Core & Vocational";
}

function categorizeSeniorSubject(name: string): "Science" | "Arts" | "Commercial" | "Core & Vocational" {
  const n = name.toLowerCase();
  if (
    n === "physics" ||
    n === "chemistry" ||
    n === "biology" ||
    n === "further math" ||
    n === "agric" ||
    n === "technical drawing"
  ) {
    return "Science";
  }
  if (
    n === "account" ||
    n === "commerce" ||
    n === "marketing" ||
    n === "economics"
  ) {
    return "Commercial";
  }
  if (
    n === "literature" ||
    n === "government" ||
    n === "crs" ||
    n.includes("religious") ||
    n.includes("history")
  ) {
    return "Arts";
  }
  return "Core & Vocational";
}

export default function AdminSubjectsPage() {
  const [subjects, setSubjects] = useState<SubjectWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "junior" | "senior">("all");
  const [seniorFilter, setSeniorFilter] = useState<"all" | "science" | "arts" | "commercial">("all");

  // Add / Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SubjectWithStats | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [subjectLevel, setSubjectLevel] = useState<SubjectLevel>("both");
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

      const formatted: SubjectWithStats[] = (subjectsData || []).map((s: any) => {
        // Resolve level from database column if present, else fallback to curriculum rules
        const resolvedLevel: SubjectLevel =
          s.level === "junior" || s.level === "senior" || s.level === "both"
            ? s.level
            : getSubjectLevel(s.name);

        return {
          ...s,
          assignedTeachers: Array.from(teacherMap.get(s.id) || []),
          level: resolvedLevel,
          periods: getSubjectPeriods(s.name, resolvedLevel === "junior" ? "junior" : "senior"),
          category: categorizeSeniorSubject(s.name),
        };
      });

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

  function handleOpenAdd(defaultLevel?: SubjectLevel) {
    setEditingSubject(null);
    setSubjectName("");
    setSubjectLevel(defaultLevel || (activeTab === "junior" ? "junior" : activeTab === "senior" ? "senior" : "both"));
    setFormError("");
    setIsModalOpen(true);
  }

  function handleOpenEdit(subj: SubjectWithStats) {
    setEditingSubject(subj);
    setSubjectName(subj.name);
    setSubjectLevel(subj.level);
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
        // Try updating with level first
        let updateRes = await supabase
          .from("subjects")
          .update({ name: cleanName, level: subjectLevel } as any)
          .eq("id", editingSubject.id);

        if (updateRes.error && updateRes.error.message.includes("level")) {
          // Fallback if level column not yet in DB schema cache
          updateRes = await supabase
            .from("subjects")
            .update({ name: cleanName })
            .eq("id", editingSubject.id);
        }

        if (updateRes.error) throw updateRes.error;
        setBannerMsg({ type: "success", text: `Subject updated to "${cleanName}"!` });
      } else {
        // Try inserting with level first
        let insertRes = await supabase
          .from("subjects")
          .insert([{ name: cleanName, level: subjectLevel } as any]);

        if (insertRes.error && insertRes.error.message.includes("level")) {
          // Fallback if level column not yet in DB schema cache
          insertRes = await supabase
            .from("subjects")
            .insert([{ name: cleanName }]);
        }

        if (insertRes.error) throw insertRes.error;
        setBannerMsg({
          type: "success",
          text: `Subject "${cleanName}" added successfully to ${
            subjectLevel === "junior"
              ? "Junior Secondary (JSS)"
              : subjectLevel === "senior"
              ? "Senior Secondary (SSS)"
              : "Both JSS & SSS"
          }!`,
        });
      }

      setIsModalOpen(false);
      await loadData();
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
        `Subject "${subj.name}" is currently assigned to ${subj.assignedTeachers.length} teacher(s) (${subj.assignedTeachers.join(
          ", "
        )}). Deleting it will remove these assignments. Are you sure you want to proceed?`
      );
      if (!confirmForce) return;
    } else {
      if (!confirm(`Are you sure you want to delete "${subj.name}"?`)) return;
    }

    try {
      const { error } = await supabase.from("subjects").delete().eq("id", subj.id);
      if (error) throw error;
      setBannerMsg({ type: "success", text: `Subject "${subj.name}" was deleted.` });
      await loadData();
      setTimeout(() => setBannerMsg(null), 5000);
    } catch (err: any) {
      console.error("Delete subject error:", err);
      alert(`Could not delete subject: ${err.message}`);
    }
  }

  async function handleBulkAddStandardCurriculum() {
    const existingNames = new Set(subjects.map((s) => s.name.trim().toLowerCase()));
    const allOfficial = Array.from(new Set([...STANDARD_JSS_SUBJECTS, ...STANDARD_SSS_SUBJECTS]));
    const missing = allOfficial.filter((name) => !existingNames.has(name.trim().toLowerCase()));

    if (missing.length === 0) {
      alert("All official Junior & Senior curriculum subjects are already in the database!");
      return;
    }

    if (!confirm(`This will add ${missing.length} missing curriculum subjects. Proceed?`)) {
      return;
    }

    try {
      // Try inserting with level
      const toInsert = missing.map((name) => ({
        name,
        level: getSubjectLevel(name),
      }));

      let { error } = await supabase.from("subjects").insert(toInsert as any);
      if (error && error.message.includes("level")) {
        const fallbackInsert = missing.map((name) => ({ name }));
        const res = await supabase.from("subjects").insert(fallbackInsert);
        error = res.error;
      }

      if (error) throw error;

      setBannerMsg({
        type: "success",
        text: `Successfully added ${missing.length} standard curriculum subjects!`,
      });
      await loadData();
      setTimeout(() => setBannerMsg(null), 6000);
    } catch (err: any) {
      console.error("Error bulk adding standard curriculum:", err);
      alert(`Failed to add standard curriculum: ${err.message}`);
    }
  }

  // Filter and sort subjects cleanly
  const juniorSubjects = useMemo(() => {
    const list = subjects.filter((s) => s.level === "junior" || s.level === "both");
    return list.sort((a, b) => {
      const idxA = STANDARD_JSS_SUBJECTS.findIndex((n) => n.toLowerCase() === a.name.toLowerCase());
      const idxB = STANDARD_JSS_SUBJECTS.findIndex((n) => n.toLowerCase() === b.name.toLowerCase());
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [subjects]);

  const seniorSubjects = useMemo(() => {
    let list = subjects.filter((s) => s.level === "senior" || s.level === "both");
    if (seniorFilter === "science") {
      list = list.filter((s) => s.category === "Science" || s.name === "Mathematics" || s.name === "English");
    } else if (seniorFilter === "arts") {
      list = list.filter((s) => s.category === "Arts" || s.name === "English" || s.name === "Economics");
    } else if (seniorFilter === "commercial") {
      list = list.filter((s) => s.category === "Commercial" || s.name === "Mathematics" || s.name === "English" || s.name === "Economics");
    }
    return list.sort((a, b) => {
      const idxA = STANDARD_SSS_SUBJECTS.findIndex((n) => n.toLowerCase() === a.name.toLowerCase());
      const idxB = STANDARD_SSS_SUBJECTS.findIndex((n) => n.toLowerCase() === b.name.toLowerCase());
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [subjects, seniorFilter]);

  const displayedSubjects = useMemo(() => {
    let baseList = subjects;
    if (activeTab === "junior") {
      baseList = juniorSubjects;
    } else if (activeTab === "senior") {
      baseList = seniorSubjects;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return baseList.filter((s) => s.name.toLowerCase().includes(q));
    }
    return baseList;
  }, [subjects, activeTab, juniorSubjects, seniorSubjects, searchQuery]);

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
              Curriculum & Subjects Management
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Organized academic curriculum separated by Junior Secondary (JSS) and Senior Secondary (SSS).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleBulkAddStandardCurriculum}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Populate missing standard curriculum subjects"
          >
            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            <span>Sync Standard Curriculum</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenAdd()}
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
            className="text-slate-400 hover:text-slate-600 cursor-pointer text-base font-bold leading-none"
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
          <p className="text-[11px] text-slate-500 mt-0.5">In catalog</p>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs border-l-4 border-l-amber-500">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600">Junior (JSS 1–3)</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{juniorSubjects.length}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">12 standard subjects</p>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs border-l-4 border-l-indigo-500">
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Senior (SSS 1–3)</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{subjects.filter((s) => s.level === "senior" || s.level === "both").length}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">19 standard subjects</p>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs border-l-4 border-l-emerald-500">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">Teacher Assigned</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{assignedCount}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Active teacher allocations</p>
        </div>
      </div>

      {/* Main Level Navigation Tabs */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-2 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Level Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === "all"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <span>🌐 All Subjects</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === "all" ? "bg-slate-800 text-slate-200" : "bg-slate-200 text-slate-700"
              }`}
            >
              {subjects.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("junior")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === "junior"
                ? "bg-amber-600 text-white shadow-xs ring-2 ring-amber-600/20"
                : "bg-amber-50 text-amber-900 hover:bg-amber-100/80 border border-amber-200/60"
            }`}
          >
            <span>📘 Junior Secondary (JSS 1 – JSS 3)</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === "junior" ? "bg-amber-700 text-white" : "bg-amber-200 text-amber-900"
              }`}
            >
              {juniorSubjects.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("senior")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === "senior"
                ? "bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-600/20"
                : "bg-indigo-50 text-indigo-900 hover:bg-indigo-100/80 border border-indigo-200/60"
            }`}
          >
            <span>🏛️ Senior Secondary (SSS 1 – SSS 3)</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === "senior" ? "bg-indigo-700 text-white" : "bg-indigo-200 text-indigo-900"
              }`}
            >
              {subjects.filter((s) => s.level === "senior" || s.level === "both").length}
            </span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-64">
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

      {/* Sub-header Context / Explanatory Section */}
      {activeTab === "junior" && (
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
          <div>
            <span className="font-bold text-sm block text-amber-900">
              Official Junior Secondary Curriculum (12 Subjects)
            </span>
            <span className="text-amber-800">
              Sorted in official academic order with assigned weekly periods. All JSS 1–3 students automatically take these subjects.
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleOpenAdd("junior")}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shrink-0 cursor-pointer self-start sm:self-auto"
          >
            + Add Subject to JSS
          </button>
        </div>
      )}

      {activeTab === "senior" && (
        <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-2xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-indigo-950">
            <div>
              <span className="font-bold text-sm block text-indigo-900">
                Official Senior Secondary Curriculum (19 Subjects)
              </span>
              <span className="text-indigo-800">
                Sorted in official academic order with weekly periods. Senior students select core subjects + track majors/electives.
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleOpenAdd("senior")}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shrink-0 cursor-pointer self-start sm:self-auto"
            >
              + Add Subject to SSS
            </button>
          </div>

          {/* Senior Stream Filters */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-indigo-100">
            <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider">
              Stream Filter:
            </span>
            {(
              [
                { id: "all", label: "All Senior (19)" },
                { id: "science", label: "Science Stream" },
                { id: "arts", label: "Arts & Humanities" },
                { id: "commercial", label: "Commercial Stream" },
              ] as const
            ).map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setSeniorFilter(filter.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                  seniorFilter === filter.id
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-indigo-800 hover:bg-indigo-100/60 border border-indigo-200/80"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Subjects Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3.5 w-12 text-center">#</th>
                <th className="px-4 py-3.5">Subject Name</th>
                <th className="px-4 py-3.5">Curriculum Level</th>
                <th className="px-4 py-3.5">Weekly Periods</th>
                <th className="px-4 py-3.5">Assigned Teachers</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    Loading official curriculum subjects…
                  </td>
                </tr>
              ) : displayedSubjects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    No subjects found matching your selection.
                  </td>
                </tr>
              ) : (
                displayedSubjects.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Index */}
                    <td className="px-6 py-3.5 text-center text-slate-400 font-mono text-[11px]">
                      {idx + 1}
                    </td>

                    {/* Subject Name */}
                    <td className="px-4 py-3.5 font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            s.level === "junior"
                              ? "bg-amber-500"
                              : s.level === "senior"
                              ? "bg-indigo-500"
                              : "bg-emerald-500"
                          }`}
                        />
                        <span className="text-sm">{s.name}</span>
                      </div>
                    </td>

                    {/* Level Badge */}
                    <td className="px-4 py-3.5">
                      {s.level === "junior" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          <span>📘</span> Junior (JSS)
                        </span>
                      )}
                      {s.level === "senior" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
                          <span>🏛️</span> Senior (SSS)
                        </span>
                      )}
                      {s.level === "both" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          <span>🌐</span> Both (JSS & SSS)
                        </span>
                      )}
                    </td>

                    {/* Weekly Periods */}
                    <td className="px-4 py-3.5">
                      {s.periods ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 font-mono text-[11px] font-bold text-slate-700">
                          <span>⏱️</span> {s.periods} periods/wk
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">—</span>
                      )}
                    </td>

                    {/* Assigned Teachers */}
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

                    {/* Actions */}
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
                ? "Modify the registered subject title and curriculum level."
                : "Specify the subject name and choose where it should be added in the curriculum."}
            </p>

            {formError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveSubject} className="space-y-4">
              {/* Subject Name Input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Subject Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Further Math, Technical Drawing, History"
                  value={subjectName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSubjectName(val);
                    // Automatically suggest level if name matches standard list
                    if (!editingSubject && val.trim().length > 2) {
                      const detected = getSubjectLevel(val);
                      setSubjectLevel(detected);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 bg-slate-50/50"
                />
              </div>

              {/* Where Subject Should Be Added (Level Selection) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Where should this subject be added? *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSubjectLevel("junior")}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      subjectLevel === "junior"
                        ? "border-amber-500 bg-amber-50 text-amber-950 font-bold ring-2 ring-amber-500/20"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      <span>📘</span> Junior
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 font-normal">
                      JSS 1, 2, 3
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubjectLevel("senior")}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      subjectLevel === "senior"
                        ? "border-indigo-500 bg-indigo-50 text-indigo-950 font-bold ring-2 ring-indigo-500/20"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      <span>🏛️</span> Senior
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 font-normal">
                      SSS 1, 2, 3
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubjectLevel("both")}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      subjectLevel === "both"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-950 font-bold ring-2 ring-emerald-500/20"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      <span>🌐</span> Both
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 font-normal">
                      JSS & SSS
                    </div>
                  </button>
                </div>
              </div>

              {/* Quick Add Suggestions */}
              {!editingSubject && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                    Quick Suggestions ({subjectLevel === "junior" ? "JSS Curriculum" : subjectLevel === "senior" ? "SSS Curriculum" : "All Curriculum"}):
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(subjectLevel === "junior"
                      ? STANDARD_JSS_SUBJECTS
                      : subjectLevel === "senior"
                      ? STANDARD_SSS_SUBJECTS
                      : Array.from(new Set([...STANDARD_JSS_SUBJECTS, ...STANDARD_SSS_SUBJECTS]))
                    )
                      .filter((n) => !subjects.some((s) => s.name.toLowerCase() === n.toLowerCase()))
                      .slice(0, 8)
                      .map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setSubjectName(preset);
                            setSubjectLevel(getSubjectLevel(preset));
                          }}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold rounded-lg transition-colors cursor-pointer"
                        >
                          + {preset}
                        </button>
                      ))}
                    {(subjectLevel === "junior"
                      ? STANDARD_JSS_SUBJECTS
                      : subjectLevel === "senior"
                      ? STANDARD_SSS_SUBJECTS
                      : Array.from(new Set([...STANDARD_JSS_SUBJECTS, ...STANDARD_SSS_SUBJECTS]))
                    ).filter((n) => !subjects.some((s) => s.name.toLowerCase() === n.toLowerCase())).length === 0 && (
                      <span className="text-[11px] text-emerald-600 font-medium">
                        ✓ All official subjects for this level are already added!
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
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
                  {saving ? "Saving…" : editingSubject ? "Save Changes" : "Add Subject"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
