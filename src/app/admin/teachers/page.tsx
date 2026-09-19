"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase/client";
import { UserProfile, ClassRecord, SubjectRecord } from "@/types/database";

interface TeacherWithAssignments extends UserProfile {
  assignedClasses: { id: string; name: string }[];
  assignedSubjects: { id: string; name: string }[];
}

export default function AdminTeachersPage() {
  const [teachers, setTeachers] = useState<TeacherWithAssignments[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Bulk upload & template
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<TeacherWithAssignments | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    classIds: [] as string[],
    subjectIds: [] as string[],
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [
        { data: teachersData, error: tErr },
        { data: classesData },
        { data: subjectsData },
        { data: assignmentsData },
      ] = await Promise.all([
        supabase.from("users").select("*").eq("role", "teacher").order("display_name"),
        supabase.from("classes").select("id, name").order("name"),
        supabase.from("subjects").select("id, name").order("name"),
        supabase
          .from("teacher_assignments")
          .select("teacher_user_id, class_id, subject_id, classes(id, name), subjects(id, name)"),
      ]);

      if (tErr) throw tErr;

      setClasses(classesData || []);
      setSubjects(subjectsData || []);

      // Group assignments by teacher_user_id
      const classMap = new Map<string, Set<string>>();
      const subjectMap = new Map<string, Set<string>>();
      const classObjMap = new Map<string, { id: string; name: string }>();
      const subjectObjMap = new Map<string, { id: string; name: string }>();

      (assignmentsData || []).forEach((a: any) => {
        const tId = a.teacher_user_id;
        if (!classMap.has(tId)) classMap.set(tId, new Set());
        if (!subjectMap.has(tId)) subjectMap.set(tId, new Set());

        if (a.classes?.name) {
          classMap.get(tId)!.add(a.classes.id);
          classObjMap.set(a.classes.id, a.classes);
        }
        if (a.subjects?.name) {
          subjectMap.get(tId)!.add(a.subjects.id);
          subjectObjMap.set(a.subjects.id, a.subjects);
        }
      });

      const list: TeacherWithAssignments[] = (teachersData || []).map((t) => {
        const cIds = Array.from(classMap.get(t.auth_id || t.id) || []);
        const sIds = Array.from(subjectMap.get(t.auth_id || t.id) || []);

        return {
          ...t,
          assignedClasses: cIds.map((id) => classObjMap.get(id)!).filter(Boolean),
          assignedSubjects: sIds.map((id) => subjectObjMap.get(id)!).filter(Boolean),
        };
      });

      setTeachers(list);
    } catch (err) {
      console.error("Failed to load teachers:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleOpenModal(teacher?: TeacherWithAssignments) {
    setFormError("");
    if (teacher) {
      setEditingTeacher(teacher);
      setFormData({
        name: teacher.display_name || "",
        email: teacher.email || "",
        password: "",
        classIds: teacher.assignedClasses.map((c) => c.id),
        subjectIds: teacher.assignedSubjects.map((s) => s.id),
      });
    } else {
      setEditingTeacher(null);
      setFormData({
        name: "",
        email: "",
        password: "",
        classIds: [],
        subjectIds: [],
      });
    }
    setIsModalOpen(true);
  }

  async function handleSaveTeacher(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);

    const { name, email, password, classIds, subjectIds } = formData;

    if (!name.trim() || !email.trim()) {
      setFormError("Name and Email are required.");
      setSaving(false);
      return;
    }

    if (!editingTeacher && !password) {
      setFormError("Password is required for creating a new teacher account.");
      setSaving(false);
      return;
    }

    try {
      let teacherAuthId = editingTeacher?.auth_id || editingTeacher?.id;

      if (!editingTeacher) {
        // 1. Create auth user via admin endpoint
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        const res = await fetch("/api/admin/create-auth-user", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
          }),
        });

        const resJson = await res.json();
        if (!res.ok) {
          throw new Error(resJson.error || "Failed to create teacher login account.");
        }

        teacherAuthId = resJson.user?.id;

        // 2. Insert into users table
        const { error: uErr } = await supabase.from("users").upsert({
          auth_id: teacherAuthId,
          email: email.trim().toLowerCase(),
          display_name: name.trim(),
          role: "teacher",
        });

        if (uErr) throw uErr;
      } else {
        // Update user display name
        const { error: uErr } = await supabase
          .from("users")
          .update({ display_name: name.trim() })
          .eq("id", editingTeacher.id);
        if (uErr) throw uErr;
      }

      // 3. Update assignments in teacher_assignments table
      if (teacherAuthId) {
        await supabase
          .from("teacher_assignments")
          .delete()
          .eq("teacher_user_id", teacherAuthId);

        const assignmentsToInsert = [];
        for (const cId of classIds) {
          if (subjectIds.length > 0) {
            for (const sId of subjectIds) {
              assignmentsToInsert.push({
                teacher_user_id: teacherAuthId,
                class_id: cId,
                subject_id: sId,
              });
            }
          } else {
            assignmentsToInsert.push({
              teacher_user_id: teacherAuthId,
              class_id: cId,
            });
          }
        }

        if (assignmentsToInsert.length > 0) {
          const { error: asgErr } = await supabase
            .from("teacher_assignments")
            .insert(assignmentsToInsert);
          if (asgErr) console.warn("Assignment update warning:", asgErr.message);
        }
      }

      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      console.error("Save teacher error:", err);
      setFormError(err.message || "Failed to save teacher.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTeacher(id: string, name?: string | null) {
    const teacherName = name || "Teacher";
    if (!confirm(`Are you sure you want to remove teacher "${teacherName}"? Access will be revoked.`)) {
      return;
    }

    try {
      const { error } = await supabase.from("users").delete().eq("id", id);
      if (error) throw error;
      loadData();
    } catch (err: any) {
      console.error("Delete teacher error:", err);
      alert(`Could not delete teacher: ${err.message}`);
    }
  }

  function handleDownloadTemplate() {
    const templateData = [
      {
        "Teacher Name": "Mr. Babatunde Adeyemi",
        "Email": "adeyemi.maths@gracemark.sch.ng",
        "Assigned Class": "JSS 1, SSS 2 Science",
        "Assigned Subject": "Mathematics",
        "Default Password": "gracemark2026!"
      },
      {
        "Teacher Name": "Mrs. Ngozi Okonjo-Eze",
        "Email": "okonjo.english@gracemark.sch.ng",
        "Assigned Class": "JSS 1, SSS 2 Arts",
        "Assigned Subject": "English Language",
        "Default Password": "gracemark2026!"
      },
      {
        "Teacher Name": "Dr. Aisha Mohammed",
        "Email": "mohammed.physics@gracemark.sch.ng",
        "Assigned Class": "SSS 2 Science, SSS 3 Science",
        "Assigned Subject": "Physics",
        "Default Password": "gracemark2026!"
      },
      {
        "Teacher Name": "Mr. Emeka Chukwu",
        "Email": "chukwu.science@gracemark.sch.ng",
        "Assigned Class": "SSS 1 Science, SSS 2 Science",
        "Assigned Subject": "Chemistry, Biology",
        "Default Password": "gracemark2026!"
      },
      {
        "Teacher Name": "Mr. Oluwaseun Davies",
        "Email": "davies.commercial@gracemark.sch.ng",
        "Assigned Class": "SSS 2 Commercial",
        "Assigned Subject": "Economics, Commerce",
        "Default Password": "gracemark2026!"
      },
      {
        "Teacher Name": "Mrs. Funmilayo Adeleke",
        "Email": "adeleke.basic@gracemark.sch.ng",
        "Assigned Class": "JSS 1, JSS 2",
        "Assigned Subject": "Basic Science, Basic Technology",
        "Default Password": "gracemark2026!"
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Teachers");
    XLSX.writeFile(workbook, "Gracemark_Teachers_Template.xlsx");
  }

  async function handleBulkUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBulkUploading(true);
    setBulkMsg(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(worksheet);

      if (!rows.length) {
        throw new Error("Uploaded spreadsheet is empty.");
      }

      const teachersList = [];
      for (const row of rows) {
        const name =
          row["Teacher Name"] ||
          row["Name"] ||
          row["Full Name"] ||
          row["name"] ||
          "";
        const email =
          row["Email"] ||
          row["Teacher Email"] ||
          row["email"] ||
          "";
        const rawClass =
          row["Assigned Class"] ||
          row["Assigned Classes"] ||
          row["Class"] ||
          row["Classes"] ||
          "";
        const rawSubject =
          row["Assigned Subject"] ||
          row["Assigned Subjects"] ||
          row["Subject"] ||
          row["Subjects"] ||
          "";
        const password =
          row["Default Password"] ||
          row["Password"] ||
          row["password"] ||
          "gracemark2026!";

        if (name && email) {
          teachersList.push({
            name: String(name).trim(),
            email: String(email).trim().toLowerCase(),
            password: String(password).trim(),
            classes: String(rawClass)
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean),
            subjects: String(rawSubject)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          });
        }
      }

      if (teachersList.length === 0) {
        throw new Error("No valid teacher rows found. Expected columns: 'Teacher Name', 'Email', 'Assigned Class', 'Assigned Subject'.");
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Authentication session not found. Please refresh the page.");

      const res = await fetch("/api/admin/bulk-import-teachers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ teachers: teachersList }),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error || "Failed to bulk import teachers.");
      }

      setBulkMsg({
        type: "success",
        text: `Successfully imported ${resJson.count} teacher(s)${resJson.errors?.length ? ` (${resJson.errors.length} warnings)` : ""}!`,
      });
      loadData();
    } catch (err: any) {
      console.error("Bulk teacher import error:", err);
      setBulkMsg({
        type: "error",
        text: `Import failed: ${err.message || "Unknown error"}`,
      });
    } finally {
      setBulkUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => setBulkMsg(null), 8000);
    }
  }

  async function handleQuickAddSubject() {
    const newName = prompt("Enter new subject name to add to curriculum:");
    if (!newName || !newName.trim()) return;
    const clean = newName.trim();
    try {
      const { data, error } = await supabase.from("subjects").insert([{ name: clean }]).select().single();
      if (error) throw error;
      setSubjects((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setFormData((prev) => ({ ...prev, subjectIds: [...prev.subjectIds, data.id] }));
    } catch (err: any) {
      alert("Failed to add subject: " + err.message);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Teachers Roster & Assignments
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage teacher accounts, class delegations, and subject score-entry authorizations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Download Template */}
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Download Excel spreadsheet template for teachers"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>Template</span>
          </button>

          {/* Hidden file input for bulk upload */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleBulkUpload}
            accept=".xlsx, .xls, .csv"
            className="hidden"
          />

          <button
            type="button"
            disabled={bulkUploading}
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>{bulkUploading ? "Importing…" : "Bulk Excel Upload"}</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            <span>Add Teacher</span>
          </button>
        </div>
      </div>

      {bulkMsg && (
        <div
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between ${
            bulkMsg.type === "error"
              ? "bg-rose-50 text-rose-700 border border-rose-200"
              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          <span>{bulkMsg.text}</span>
          <button
            type="button"
            onClick={() => setBulkMsg(null)}
            className="text-slate-400 hover:text-slate-600 cursor-pointer ml-4"
          >
            &times;
          </button>
        </div>
      )}

      {/* Teachers Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3.5">Teacher Name</th>
                <th className="px-4 py-3.5">Login Email</th>
                <th className="px-4 py-3.5">Assigned Classes</th>
                <th className="px-4 py-3.5">Assigned Subjects</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    Loading teacher roster…
                  </td>
                </tr>
              ) : teachers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    No teachers found. Click "Add Teacher" above.
                  </td>
                </tr>
              ) : (
                teachers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3.5 font-bold text-slate-900">
                      {t.display_name}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-600">
                      {t.email}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {t.assignedClasses.length > 0 ? (
                          t.assignedClasses.map((c) => (
                            <span
                              key={c.id}
                              className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-semibold border border-blue-200"
                            >
                              {c.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400 italic">None</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {t.assignedSubjects.length > 0 ? (
                          t.assignedSubjects.map((s) => (
                            <span
                              key={s.id}
                              className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200"
                            >
                              {s.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400 italic">None</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(t)}
                        className="text-indigo-600 hover:text-indigo-900 font-semibold cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTeacher(t.id, t.display_name)}
                        className="text-rose-600 hover:text-rose-800 font-semibold cursor-pointer"
                      >
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

      {/* Add / Edit Teacher Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 tracking-tight">
                {editingTeacher ? "Edit Teacher & Delegations" : "Add New Teacher"}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            {formError && (
              <div className="mt-4 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveTeacher} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Teacher Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Mr. Smith"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  disabled={Boolean(editingTeacher)}
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="e.g. smith@gracemark.edu.ng"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white text-xs disabled:opacity-60"
                />
              </div>

              {!editingTeacher && (
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                    Initial Password *
                  </label>
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Create a strong password"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
                  />
                </div>
              )}

              {/* Class delegations checkboxes */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1.5">
                  Assigned Classes
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200">
                  {classes.map((c) => {
                    const checked = formData.classIds.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 text-slate-800 font-medium cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                classIds: [...formData.classIds, c.id],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                classIds: formData.classIds.filter((id) => id !== c.id),
                              });
                            }
                          }}
                          className="rounded text-slate-900 focus:ring-slate-900"
                        />
                        <span className="truncate">{c.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Subject delegations checkboxes */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                    Assigned Subjects
                  </label>
                  <button
                    type="button"
                    onClick={handleQuickAddSubject}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    + New Subject
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200">
                  {subjects.map((s) => {
                    const checked = formData.subjectIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 text-slate-800 font-medium cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                subjectIds: [...formData.subjectIds, s.id],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                subjectIds: formData.subjectIds.filter((id) => id !== s.id),
                              });
                            }
                          }}
                          className="rounded text-slate-900 focus:ring-slate-900"
                        />
                        <span className="truncate">{s.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Teacher"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
