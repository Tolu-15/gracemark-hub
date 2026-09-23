"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase/client";
import { ClassRecord, SubjectRecord } from "@/types/database";
import { StaffProfile, ClassTeacherAssignment, SubjectTeacherAssignment } from "@/types/academic";
import { getAcademicSessions } from "@/lib/academicSessions";
import { getAppSettings } from "@/lib/appSettings";

type TabMode = "directory" | "class-teachers" | "subject-teachers";

export interface ClassGroup {
  id: string;
  name: string;
  subName?: string;
  classIds: string[];
}

export default function AdminTeachersPage() {
  const [activeTab, setActiveTab] = useState<TabMode>("directory");
  const [loading, setLoading] = useState(true);

  // Core catalogs
  const [teachers, setTeachers] = useState<StaffProfile[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const [selectedSession, setSelectedSession] = useState("");

  // Search & Filter in Directory
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "former">("all");

  // Class Teacher Tab State
  const [classAssignments, setClassAssignments] = useState<ClassTeacherAssignment[]>([]);
  const [selectedClassForHistory, setSelectedClassForHistory] = useState<ClassGroup | null>(null);
  const [classHistoryModalOpen, setClassHistoryModalOpen] = useState(false);
  const [classHistoryList, setClassHistoryList] = useState<ClassTeacherAssignment[]>([]);

  // Assign / Replace Class Teacher Modal
  const [assignClassModalOpen, setAssignClassModalOpen] = useState(false);
  const [targetClassForAssignment, setTargetClassForAssignment] = useState<ClassGroup | null>(null);
  const [selectedTeacherForClass, setSelectedTeacherForClass] = useState("");
  const [classAssignNotes, setClassAssignNotes] = useState("");
  const [savingClassAssign, setSavingClassAssign] = useState(false);

  // Subject Teacher Tab State
  const [selectedSubjectClass, setSelectedSubjectClass] = useState("");
  const [subjectAssignments, setSubjectAssignments] = useState<SubjectTeacherAssignment[]>([]);
  const [selectedSubjectForHistory, setSelectedSubjectForHistory] = useState<SubjectRecord | null>(null);
  const [subjectHistoryModalOpen, setSubjectHistoryModalOpen] = useState(false);
  const [subjectHistoryList, setSubjectHistoryList] = useState<SubjectTeacherAssignment[]>([]);

  // Assign / Replace Subject Teacher Modal
  const [assignSubjectModalOpen, setAssignSubjectModalOpen] = useState(false);
  const [targetSubjectForAssignment, setTargetSubjectForAssignment] = useState<SubjectRecord | null>(null);
  const [selectedTeacherForSubject, setSelectedTeacherForSubject] = useState("");
  const [subjectAssignNotes, setSubjectAssignNotes] = useState("");
  const [savingSubjectAssign, setSavingSubjectAssign] = useState(false);

  // Teacher Profile Modal (Add / Edit)
  const [isTeacherModalOpen, setIsTeacherModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<StaffProfile | null>(null);
  const [teacherFormData, setTeacherFormData] = useState({
    name: "",
    staffId: "",
    phone: "",
    password: "gracemark",
    mustChangePassword: true,
  });
  const [teacherFormError, setTeacherFormError] = useState("");
  const [savingTeacher, setSavingTeacher] = useState(false);

  // Bulk upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadTeachers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/teachers");
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          setTeachers(json.teachers || []);
          return;
        }
      }
      // Fallback
      const { data } = await supabase.from("users").select("*").eq("role", "teacher").order("display_name");
      setTeachers((data as any) || []);
    } catch (err) {
      console.error("Load teachers error:", err);
    }
  }, []);

  // Load Sessions & Base Data
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessList, settings, classesRes, subjectsRes] = await Promise.all([
        getAcademicSessions(),
        getAppSettings(),
        supabase.from("classes").select("id, name").order("name", { ascending: true }),
        supabase.from("subjects").select("id, name").order("name", { ascending: true }),
      ]);

      const sNames = (sessList || []).map((s: { name: string }) => s.name);
      setSessions(sNames);

      const activeSess = settings?.current_session || sNames[0] || "2026/2027";
      setSelectedSession(activeSess);

      if (classesRes.data) {
        setClasses(classesRes.data as ClassRecord[]);
        if (classesRes.data.length > 0) setSelectedSubjectClass(classesRes.data[0].id);
      }
      if (subjectsRes.data) {
        setSubjects(subjectsRes.data as SubjectRecord[]);
      }

      await loadTeachers();
    } catch (err) {
      console.error("Failed to load initial data:", err);
    } finally {
      setLoading(false);
    }
  }, [loadTeachers]);

  // Compute Unified Class Groups for Class Teacher Tab (SSS 1, SSS 2, SSS 3 unified across arms)
  const classGroups: ClassGroup[] = React.useMemo(() => {
    const groups: ClassGroup[] = [];
    const sss1Classes = classes.filter((c) => /^(SSS\s*1|SS\s*1)/i.test(c.name));
    const sss2Classes = classes.filter((c) => /^(SSS\s*2|SS\s*2)/i.test(c.name));
    const sss3Classes = classes.filter((c) => /^(SSS\s*3|SS\s*3)/i.test(c.name));
    const otherClasses = classes.filter(
      (c) => !/^(SSS\s*[123]|SS\s*[123])/i.test(c.name)
    );

    otherClasses.forEach((c) => {
      groups.push({
        id: c.id,
        name: c.name,
        classIds: [c.id],
      });
    });

    if (sss1Classes.length > 0) {
      groups.push({
        id: sss1Classes[0].id,
        name: "SSS 1",
        subName: "All Arms: Science, Arts, Commercial",
        classIds: sss1Classes.map((c) => c.id),
      });
    }

    if (sss2Classes.length > 0) {
      groups.push({
        id: sss2Classes[0].id,
        name: "SSS 2",
        subName: "All Arms: Science, Arts, Commercial",
        classIds: sss2Classes.map((c) => c.id),
      });
    }

    if (sss3Classes.length > 0) {
      groups.push({
        id: sss3Classes[0].id,
        name: "SSS 3",
        subName: "All Arms: Science, Arts, Commercial",
        classIds: sss3Classes.map((c) => c.id),
      });
    }

    const orderWeight = (name: string) => {
      if (/JSS\s*1/i.test(name)) return 1;
      if (/JSS\s*2/i.test(name)) return 2;
      if (/JSS\s*3/i.test(name)) return 3;
      if (/SSS\s*1|SS\s*1/i.test(name)) return 4;
      if (/SSS\s*2|SS\s*2/i.test(name)) return 5;
      if (/SSS\s*3|SS\s*3/i.test(name)) return 6;
      return 10;
    };

    return groups.sort((a, b) => orderWeight(a.name) - orderWeight(b.name));
  }, [classes]);

  const loadAssignments = useCallback(async () => {
    if (!selectedSession) return;
    try {
      const res = await fetch(`/api/admin/teachers/assignments?session=${encodeURIComponent(selectedSession)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          setClassAssignments(json.classAssignments || []);
          setSubjectAssignments(json.subjectAssignments || []);
        }
      }
    } catch (err) {
      console.error("Load assignments error:", err);
    }
  }, [selectedSession]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (selectedSession) {
      loadAssignments();
    }
  }, [selectedSession, loadAssignments]);

  // Generate next teacher ID: GMT001, GMT002...
  function generateNextStaffId() {
    let maxNum = 0;
    teachers.forEach((t) => {
      const sid = t.staff_id || "";
      const match = sid.match(/GMT-?(\d+)/i) || sid.match(/GMA-T-(\d+)/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    return `GMT${String(maxNum + 1).padStart(3, "0")}`;
  }

  function handleOpenAddTeacherModal() {
    setTeacherFormError("");
    setEditingTeacher(null);
    const nextId = generateNextStaffId();
    setTeacherFormData({
      name: "",
      staffId: nextId,
      phone: "",
      password: "gracemark",
      mustChangePassword: false,
    });
    setIsTeacherModalOpen(true);
  }

  function handleOpenEditTeacherModal(t: StaffProfile) {
    setTeacherFormError("");
    setEditingTeacher(t);
    setTeacherFormData({
      name: t.display_name || "",
      staffId: t.staff_id || "",
      phone: t.phone || "",
      password: "",
      mustChangePassword: Boolean(t.must_change_password),
    });
    setIsTeacherModalOpen(true);
  }

  async function handleSaveTeacherProfile(e: React.FormEvent) {
    e.preventDefault();
    setTeacherFormError("");
    setSavingTeacher(true);

    try {
      if (!editingTeacher) {
        // Create new teacher directly via server POST API
        const res = await fetch("/api/admin/teachers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: teacherFormData.name.trim(),
            staffId: teacherFormData.staffId.trim().toUpperCase(),
            phone: teacherFormData.phone.trim(),
            password: teacherFormData.password.trim() || "gracemark",
            mustChangePassword: teacherFormData.mustChangePassword,
          }),
        });

        const resJson = await res.json();
        if (!res.ok || !resJson.ok) {
          throw new Error(resJson.error || "Failed to register teacher.");
        }
      } else {
        // Update existing teacher profile via server PATCH API
        const res = await fetch("/api/admin/teachers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teacherId: editingTeacher.id,
            authId: editingTeacher.auth_id,
            display_name: teacherFormData.name.trim(),
            staff_id: teacherFormData.staffId.trim().toUpperCase() || null,
            phone: teacherFormData.phone.trim() || null,
          }),
        });

        const resJson = await res.json();
        if (!res.ok || !resJson.ok) {
          throw new Error(resJson.error || "Failed to update teacher profile.");
        }
      }

      setIsTeacherModalOpen(false);
      await loadTeachers();
    } catch (err: any) {
      setTeacherFormError(err.message || "Failed to save teacher profile.");
    } finally {
      setSavingTeacher(false);
    }
  }

  async function handleToggleTeacherStatus(t: StaffProfile) {
    const newStatus = t.status === "former" ? "active" : "former";
    const promptMsg =
      newStatus === "former"
        ? `Mark ${t.display_name} as Former Staff?\nThis will end their current active duties and revoke portal access.`
        : `Reactivate ${t.display_name} as Active Staff?`;

    if (!confirm(promptMsg)) return;

    try {
      const res = await fetch("/api/admin/teachers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authId: t.auth_id,
          teacherId: t.id,
          status: newStatus,
        }),
      });

      if (!res.ok) throw new Error("Failed to update teacher status.");
      await loadTeachers();
      await loadAssignments();
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  }

  // Assign Class Teacher Handlers
  function handleOpenAssignClassModal(group: ClassGroup) {
    setTargetClassForAssignment(group);
    const current = classAssignments.find((a) => group.classIds.includes(a.class_id) && a.status === "active");
    setSelectedTeacherForClass(current?.teacher_user_id || "");
    setClassAssignNotes("");
    setAssignClassModalOpen(true);
  }

  async function handleSaveClassTeacherAssignment() {
    if (!targetClassForAssignment || !selectedTeacherForClass) {
      alert("Please select a teacher to assign.");
      return;
    }

    setSavingClassAssign(true);
    try {
      const res = await fetch("/api/admin/teachers/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "class",
          session: selectedSession,
          classId: targetClassForAssignment.id,
          classIds: targetClassForAssignment.classIds,
          teacherUserId: selectedTeacherForClass,
          notes: classAssignNotes,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to assign class teacher.");

      setAssignClassModalOpen(false);
      await loadAssignments();
      alert(`Class Teacher successfully assigned to ${targetClassForAssignment.name}!`);
    } catch (err: any) {
      alert("Failed to assign class teacher: " + err.message);
    } finally {
      setSavingClassAssign(false);
    }
  }

  function handleOpenClassHistory(group: ClassGroup) {
    setSelectedClassForHistory(group);
    const history = classAssignments.filter((a) => group.classIds.includes(a.class_id));
    setClassHistoryList(history);
    setClassHistoryModalOpen(true);
  }

  // Assign Subject Teacher Handlers
  function handleOpenAssignSubjectModal(sub: SubjectRecord) {
    setTargetSubjectForAssignment(sub);
    const current = subjectAssignments.find(
      (a) => a.class_id === selectedSubjectClass && a.subject_id === sub.id && a.status === "active"
    );
    setSelectedTeacherForSubject(current?.teacher_user_id || "");
    setSubjectAssignNotes("");
    setAssignSubjectModalOpen(true);
  }

  async function handleSaveSubjectTeacherAssignment() {
    if (!targetSubjectForAssignment || !selectedSubjectClass || !selectedTeacherForSubject) {
      alert("Please select a teacher to assign.");
      return;
    }

    const currentCl = classes.find((c) => c.id === selectedSubjectClass);
    setSavingSubjectAssign(true);
    try {
      const res = await fetch("/api/admin/teachers/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "subject",
          session: selectedSession,
          classId: selectedSubjectClass,
          subjectId: targetSubjectForAssignment.id,
          teacherUserId: selectedTeacherForSubject,
          notes: subjectAssignNotes,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to assign subject teacher.");

      setAssignSubjectModalOpen(false);
      await loadAssignments();
      alert(`Subject teacher assigned for ${targetSubjectForAssignment.name} (${currentCl?.name || ""})!`);
    } catch (err: any) {
      alert("Failed to assign subject teacher: " + err.message);
    } finally {
      setSavingSubjectAssign(false);
    }
  }

  function handleOpenSubjectHistory(sub: SubjectRecord) {
    setSelectedSubjectForHistory(sub);
    const history = subjectAssignments.filter(
      (a) => a.class_id === selectedSubjectClass && a.subject_id === sub.id
    );
    setSubjectHistoryList(history);
    setSubjectHistoryModalOpen(true);
  }

  // Directory Filter
  const filteredTeachers = teachers.filter((t) => {
    const matchesSearch =
      (t.display_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.staff_id || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.email || "").toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "all" ? true : statusFilter === "former" ? t.status === "former" : t.status !== "former";

    return matchesSearch && matchesStatus;
  });

  const activeTeachers = teachers.filter((t) => t.status !== "former");

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Academic Staff & Teacher Assignments
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Manage teacher profiles, separate Class Teachers (attendance) from Subject Teachers (gradebook), and audit replacement history.
          </p>
        </div>

        {/* Global Academic Session Selector */}
        <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200">
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wider pl-1">Session:</span>
          <select
            value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            {sessions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("directory")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold tracking-tight transition cursor-pointer ${
            activeTab === "directory"
              ? "bg-slate-900 text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Staff Directory ({teachers.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("class-teachers")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold tracking-tight transition cursor-pointer flex items-center gap-2 ${
            activeTab === "class-teachers"
              ? "bg-slate-900 text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <span>Class Teachers</span>
          <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-blue-100 text-blue-700 font-extrabold">
            {classAssignments.filter((a) => a.status === "active").length} Assigned
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("subject-teachers")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold tracking-tight transition cursor-pointer flex items-center gap-2 ${
            activeTab === "subject-teachers"
              ? "bg-slate-900 text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <span>Subject Teachers</span>
          <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-emerald-100 text-emerald-700 font-extrabold">
            {subjectAssignments.filter((a) => a.status === "active").length} Assigned
          </span>
        </button>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: STAFF DIRECTORY */}
      {/* ==================================================================== */}
      {activeTab === "directory" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name, staff ID, or email..."
                className="w-full sm:w-72 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
              >
                <option value="all">All Status</option>
                <option value="active">Active Staff Only</option>
                <option value="former">Former Staff Only</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleOpenAddTeacherModal}
              className="w-full sm:w-auto px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              <span>Add New Teacher</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-6 py-3.5">Teacher ID & Name</th>
                    <th className="px-4 py-3.5">Phone Number</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Active Duties ({selectedSession})</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                        Loading staff directory…
                      </td>
                    </tr>
                  ) : filteredTeachers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                        No teachers found matching your criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredTeachers.map((t) => {
                      const isFormer = t.status === "former";
                      const classDuties = classAssignments.filter(
                        (a) => a.teacher_user_id === t.auth_id && a.status === "active"
                      );
                      const subjectDuties = subjectAssignments.filter(
                        (a) => a.teacher_user_id === t.auth_id && a.status === "active"
                      );

                      return (
                        <tr key={t.id} className={`hover:bg-slate-50/70 transition ${isFormer ? "bg-slate-50/40 opacity-75" : ""}`}>
                          <td className="px-6 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-slate-900 text-white font-bold flex items-center justify-center text-xs shrink-0">
                                {t.display_name?.charAt(0) || "T"}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900">{t.display_name}</div>
                                <div className="font-mono text-[11px] text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded-md inline-block mt-0.5">
                                  {t.staff_id || "GMT"}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3.5 text-xs text-slate-700 font-medium">
                            {t.phone || "—"}
                          </td>

                          <td className="px-4 py-3.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isFormer
                                  ? "bg-slate-200 text-slate-600"
                                  : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              }`}
                            >
                              {isFormer ? "Former Staff" : "Active Staff"}
                            </span>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="flex flex-col gap-1">
                              {classDuties.length > 0 && (
                                <span className="text-[10px] text-blue-700 font-semibold">
                                  Class: {classDuties.map((d: any) => d.classes?.name).join(", ")}
                                </span>
                              )}
                              {subjectDuties.length > 0 && (
                                <span className="text-[10px] text-emerald-700 font-semibold">
                                  {subjectDuties.length} subject {subjectDuties.length === 1 ? "duty" : "duties"}
                                </span>
                              )}
                              {classDuties.length === 0 && subjectDuties.length === 0 && (
                                <span className="text-slate-400 italic text-[11px]">No active duties</span>
                              )}
                            </div>
                          </td>

                          <td className="px-6 py-3.5 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => handleOpenEditTeacherModal(t)}
                              className="text-indigo-600 hover:text-indigo-900 font-bold cursor-pointer"
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleTeacherStatus(t)}
                              className={`font-semibold cursor-pointer ${
                                isFormer ? "text-emerald-600 hover:text-emerald-800" : "text-amber-600 hover:text-amber-800"
                              }`}
                            >
                              {isFormer ? "Reactivate" : "Mark Former"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: CLASS TEACHERS ASSIGNMENTS */}
      {/* ==================================================================== */}
      {activeTab === "class-teachers" && (
        <div className="space-y-4">
          <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-2xl flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-xs text-blue-900">
              <span className="font-bold">Class Teacher Roles:</span> Class Teachers manage attendance, pastoral care, and end-of-term remarks. For senior classes (SSS 1, SSS 2, SSS 3), assigning a class teacher covers all arms (Science, Arts, Commercial) together.
            </div>
          </div>

          {/* MOBILE VIEW (< md): Touch-Friendly Cards */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {classGroups.map((group) => {
              const assignment = classAssignments.find(
                (a) => group.classIds.includes(a.class_id) && a.status === "active"
              );
              const teacher = assignment?.teacher;

              return (
                <div key={group.name} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-slate-900 text-base">{group.name}</h4>
                      {group.subName ? (
                        <p className="text-[11px] text-blue-600 font-semibold">{group.subName}</p>
                      ) : (
                        <p className="text-[11px] text-slate-400">Main Class</p>
                      )}
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        teacher
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          : "bg-amber-100 text-amber-800 border border-amber-200"
                      }`}
                    >
                      {teacher ? "Assigned" : "Vacant"}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Assigned Class Teacher
                    </span>
                    {teacher ? (
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-800 font-bold flex items-center justify-center text-xs shrink-0">
                          {teacher.display_name?.charAt(0) || "T"}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 text-xs">{teacher.display_name}</div>
                          <div className="text-[10px] font-mono text-indigo-700 font-bold">{teacher.staff_id || teacher.email}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Assigned: <span className="font-mono text-slate-700 font-medium">{assignment?.start_date || "—"}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-700 italic font-medium">No Class Teacher Assigned</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleOpenAssignClassModal(group)}
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs cursor-pointer transition text-center shadow-xs"
                    >
                      {teacher ? "Change Teacher" : "Assign Teacher"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenClassHistory(group)}
                      className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold text-xs cursor-pointer transition text-center"
                    >
                      History
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* DESKTOP VIEW (>= md): Full Table with overflow-x-auto */}
          <div className="hidden md:block bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-6 py-3.5">Class / Level</th>
                    <th className="px-4 py-3.5">Coverage</th>
                    <th className="px-6 py-3.5">Current Class Teacher ({selectedSession})</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Assigned Date</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {classGroups.map((group) => {
                    const assignment = classAssignments.find(
                      (a) => group.classIds.includes(a.class_id) && a.status === "active"
                    );
                    const teacher = assignment?.teacher;

                    return (
                      <tr key={group.name} className="hover:bg-slate-50/70 transition">
                        <td className="px-6 py-3.5 font-bold text-slate-900 text-sm">{group.name}</td>
                        <td className="px-4 py-3.5">
                          <span className="text-xs text-slate-600 font-medium">
                            {group.subName || "Main"}
                          </span>
                        </td>

                        <td className="px-6 py-3.5">
                          {teacher ? (
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-800 font-bold flex items-center justify-center text-xs shrink-0">
                                {teacher.display_name?.charAt(0) || "T"}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900">{teacher.display_name}</div>
                                <div className="text-[10px] font-mono text-indigo-700 font-bold">{teacher.staff_id || teacher.email}</div>
                              </div>
                            </div>
                          ) : (
                            <span className="text-amber-600 font-semibold italic text-xs">No Class Teacher Assigned</span>
                          )}
                        </td>

                        <td className="px-4 py-3.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              teacher
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                : "bg-amber-100 text-amber-800 border border-amber-200"
                            }`}
                          >
                            {teacher ? "Assigned" : "Vacant"}
                          </span>
                        </td>

                        <td className="px-4 py-3.5 text-slate-600 font-mono text-[11px]">
                          {assignment?.start_date || "—"}
                        </td>

                        <td className="px-6 py-3.5 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => handleOpenAssignClassModal(group)}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold text-xs cursor-pointer transition"
                          >
                            {teacher ? "Change Teacher" : "Assign Teacher"}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenClassHistory(group)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-xs cursor-pointer transition"
                          >
                            History
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: SUBJECT TEACHERS ASSIGNMENTS */}
      {/* ==================================================================== */}
      {activeTab === "subject-teachers" && (
        <div className="space-y-4">
          <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl flex items-start gap-3">
            <svg className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-xs text-emerald-900">
              <span className="font-bold">Subject Teacher Roles:</span> Each subject within a class is assigned independently. Subject teachers only have gradebook access for the specific subjects they teach in that class.
            </div>
          </div>

          {/* Class Filter Dropdown */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider shrink-0">Select Class:</span>
              <select
                value={selectedSubjectClass}
                onChange={(e) => setSelectedSubjectClass(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 w-full sm:w-64"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <span className="text-xs text-slate-500 sm:ml-auto font-medium">
              Showing all {subjects.length} subjects for <span className="font-bold text-slate-900">{classes.find((c) => c.id === selectedSubjectClass)?.name}</span>
            </span>
          </div>

          {/* MOBILE VIEW (< md): Touch-Friendly Subject Cards */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {subjects.map((sub) => {
              const assignment = subjectAssignments.find(
                (a) => a.class_id === selectedSubjectClass && a.subject_id === sub.id && a.status === "active"
              );
              const teacher = assignment?.teacher;

              return (
                <div key={sub.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-slate-900 text-sm">{sub.name}</h4>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        teacher
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {teacher ? "Assigned" : "Unassigned"}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Assigned Subject Teacher
                    </span>
                    {teacher ? (
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs shrink-0">
                          {teacher.display_name?.charAt(0) || "T"}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 text-xs">{teacher.display_name}</div>
                          <div className="text-[10px] font-mono text-indigo-700 font-bold">{teacher.staff_id || teacher.email}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Assigned Since: <span className="font-mono text-slate-700 font-medium">{assignment?.start_date || "—"}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic">No subject teacher assigned yet</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleOpenAssignSubjectModal(sub)}
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs cursor-pointer transition text-center shadow-xs"
                    >
                      {teacher ? "Change Teacher" : "Assign Teacher"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenSubjectHistory(sub)}
                      className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold text-xs cursor-pointer transition text-center"
                    >
                      History
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* DESKTOP VIEW (>= md): Full Table with overflow-x-auto */}
          <div className="hidden md:block bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-6 py-3.5">Subject</th>
                    <th className="px-6 py-3.5">Assigned Subject Teacher ({selectedSession})</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Assigned Since</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {subjects.map((sub) => {
                    const assignment = subjectAssignments.find(
                      (a) => a.class_id === selectedSubjectClass && a.subject_id === sub.id && a.status === "active"
                    );
                    const teacher = assignment?.teacher;

                    return (
                      <tr key={sub.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-6 py-3.5 font-bold text-slate-900">{sub.name}</td>

                        <td className="px-6 py-3.5">
                          {teacher ? (
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs shrink-0">
                                {teacher.display_name?.charAt(0) || "T"}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900">{teacher.display_name}</div>
                                <div className="text-[10px] font-mono text-indigo-700 font-bold">{teacher.staff_id || teacher.email}</div>
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-xs">Unassigned</span>
                          )}
                        </td>

                        <td className="px-4 py-3.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              teacher
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {teacher ? "Assigned" : "Unassigned"}
                          </span>
                        </td>

                        <td className="px-4 py-3.5 text-slate-600 font-mono text-[11px]">
                          {assignment?.start_date || "—"}
                        </td>

                        <td className="px-6 py-3.5 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => handleOpenAssignSubjectModal(sub)}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold text-xs cursor-pointer transition"
                          >
                            {teacher ? "Change Teacher" : "Assign Teacher"}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenSubjectHistory(sub)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-xs cursor-pointer transition"
                          >
                            History
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: ASSIGN / REPLACE CLASS TEACHER */}
      {/* ==================================================================== */}
      {assignClassModalOpen && targetClassForAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Assign Class Teacher — {targetClassForAssignment.name}
                </h3>
                {targetClassForAssignment.subName && (
                  <p className="text-xs text-blue-600 font-semibold">{targetClassForAssignment.subName}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAssignClassModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Academic Session
                </label>
                <input
                  type="text"
                  disabled
                  value={selectedSession}
                  className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-700 font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Select Class Teacher *
                </label>
                <select
                  value={selectedTeacherForClass}
                  onChange={(e) => setSelectedTeacherForClass(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">-- Choose Active Teacher --</option>
                  {activeTeachers.map((t) => (
                    <option key={t.auth_id} value={t.auth_id}>
                      {t.display_name} ({t.staff_id || t.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Handover Notes / Reason (Optional)
                </label>
                <textarea
                  value={classAssignNotes}
                  onChange={(e) => setClassAssignNotes(e.target.value)}
                  placeholder="e.g. Appointed as Class Teacher for 2026/2027 cycle..."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-800">
                {targetClassForAssignment.subName
                  ? `Assigning this Class Teacher will automatically apply to all arms (${targetClassForAssignment.subName}) for attendance and remarks.`
                  : "Assigning a new teacher will automatically end any active class teacher assignment for this class while preserving audit history."}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignClassModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingClassAssign || !selectedTeacherForClass}
                  onClick={handleSaveClassTeacherAssignment}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold cursor-pointer transition disabled:opacity-50"
                >
                  {savingClassAssign ? "Saving…" : "Save Assignment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: CLASS TEACHER AUDIT HISTORY */}
      {/* ==================================================================== */}
      {classHistoryModalOpen && selectedClassForHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Class Teacher History — {selectedClassForHistory.name}
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedClassForHistory.subName ? `${selectedClassForHistory.subName} • ` : ""}Session: {selectedSession}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClassHistoryModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 max-h-80 overflow-y-auto space-y-3">
              {classHistoryList.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No historical assignments recorded yet.</p>
              ) : (
                classHistoryList.map((h, i) => (
                  <div
                    key={h.id || i}
                    className={`p-3 rounded-xl border ${
                      h.status === "active"
                        ? "bg-emerald-50/60 border-emerald-200"
                        : "bg-slate-50 border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-xs">
                        {h.teacher?.display_name || "Unknown Teacher"} ({h.teacher?.staff_id || "No ID"})
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          h.status === "active" ? "bg-emerald-200 text-emerald-900" : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {h.status === "active" ? "Current Active" : "Ended"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono">
                      {h.start_date} → {h.end_date || "Present"}
                    </div>
                    {h.notes && <div className="text-[11px] text-slate-600 mt-1 italic">{h.notes}</div>}
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setClassHistoryModalOpen(false)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Close History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: ASSIGN / REPLACE SUBJECT TEACHER */}
      {/* ==================================================================== */}
      {assignSubjectModalOpen && targetSubjectForAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Assign Subject Teacher
                </h3>
                <p className="text-xs text-slate-500">
                  {targetSubjectForAssignment.name} — {classes.find((c) => c.id === selectedSubjectClass)?.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignSubjectModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Select Subject Teacher *
                </label>
                <select
                  value={selectedTeacherForSubject}
                  onChange={(e) => setSelectedTeacherForSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">-- Choose Active Teacher --</option>
                  {activeTeachers.map((t) => (
                    <option key={t.auth_id} value={t.auth_id}>
                      {t.display_name} ({t.staff_id || t.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Handover Notes / Reason (Optional)
                </label>
                <textarea
                  value={subjectAssignNotes}
                  onChange={(e) => setSubjectAssignNotes(e.target.value)}
                  placeholder="e.g. Taking over 2nd Term continuous assessments..."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-500">
                Note: Each subject is assigned independently. This teacher will only be granted score entry privileges for {targetSubjectForAssignment.name} in this class.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignSubjectModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingSubjectAssign || !selectedTeacherForSubject}
                  onClick={handleSaveSubjectTeacherAssignment}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold cursor-pointer transition disabled:opacity-50"
                >
                  {savingSubjectAssign ? "Saving…" : "Save Assignment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: SUBJECT TEACHER AUDIT HISTORY */}
      {/* ==================================================================== */}
      {subjectHistoryModalOpen && targetSubjectForAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Subject Teacher History — {targetSubjectForAssignment.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Class: {classes.find((c) => c.id === selectedSubjectClass)?.name} • Session: {selectedSession}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubjectHistoryModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 max-h-80 overflow-y-auto space-y-3">
              {subjectHistoryList.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No historical assignments recorded yet.</p>
              ) : (
                subjectHistoryList.map((h, i) => (
                  <div
                    key={h.id || i}
                    className={`p-3 rounded-xl border ${
                      h.status === "active"
                        ? "bg-emerald-50/60 border-emerald-200"
                        : "bg-slate-50 border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-xs">
                        {h.teacher?.display_name || "Unknown Teacher"} ({h.teacher?.staff_id || "No ID"})
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          h.status === "active" ? "bg-emerald-200 text-emerald-900" : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {h.status === "active" ? "Current Active" : "Ended"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono">
                      {h.start_date} → {h.end_date || "Present"}
                    </div>
                    {h.notes && <div className="text-[11px] text-slate-600 mt-1 italic">{h.notes}</div>}
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSubjectHistoryModalOpen(false)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Close History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: ADD / EDIT TEACHER PROFILE */}
      {/* ==================================================================== */}
      {isTeacherModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900">
                {editingTeacher ? "Edit Teacher Profile" : "Register New Teacher"}
              </h3>
              <button
                type="button"
                onClick={() => setIsTeacherModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            {teacherFormError && (
              <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                {teacherFormError}
              </div>
            )}

            <form onSubmit={handleSaveTeacherProfile} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={teacherFormData.name}
                  onChange={(e) => setTeacherFormData({ ...teacherFormData, name: e.target.value })}
                  placeholder="e.g. Mr. Babatunde Adeyemi"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                    Teacher ID (Login ID) *
                  </label>
                  <input
                    type="text"
                    required
                    value={teacherFormData.staffId}
                    onChange={(e) => setTeacherFormData({ ...teacherFormData, staffId: e.target.value.toUpperCase() })}
                    placeholder="e.g. GMT001"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono text-indigo-700 font-bold focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Teachers use this ID to sign in
                  </span>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={teacherFormData.phone}
                    onChange={(e) => setTeacherFormData({ ...teacherFormData, phone: e.target.value })}
                    placeholder="e.g. 08012345678"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              {!editingTeacher && (
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                    Initial Password *
                  </label>
                  <input
                    type="text"
                    required
                    value={teacherFormData.password}
                    onChange={(e) => setTeacherFormData({ ...teacherFormData, password: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold text-slate-900"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="mustChangePwd"
                  checked={teacherFormData.mustChangePassword}
                  onChange={(e) => setTeacherFormData({ ...teacherFormData, mustChangePassword: e.target.checked })}
                  className="rounded text-slate-900 focus:ring-slate-900"
                />
                <label htmlFor="mustChangePwd" className="font-semibold text-slate-700 cursor-pointer">
                  Require password change on first login
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsTeacherModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTeacher}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold cursor-pointer transition disabled:opacity-50"
                >
                  {savingTeacher ? "Saving…" : editingTeacher ? "Update Profile" : "Register Teacher"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
