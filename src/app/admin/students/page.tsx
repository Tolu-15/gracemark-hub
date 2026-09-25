"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import { StudentRecord, ClassRecord } from "@/types/database";

export default function AdminStudentsPage() {
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClass, setSelectedClass] = useState("");

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    admission_no: "",
    class_id: "",
    gender: "" as "" | "male" | "female",
    email: "",
    password: "",
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Password reset states
  const [resetModalStudent, setResetModalStudent] = useState<StudentRecord | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetResult, setResetResult] = useState<{
    temporaryPassword: string;
    studentName: string;
    admissionNo: string;
    email?: string;
  } | null>(null);
  const [copiedPass, setCopiedPass] = useState(false);

  // Bulk upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");

  // Read-only subjects view (subjects come from the class subject list)
  const [subjectModalStudent, setSubjectModalStudent] = useState<StudentRecord | null>(null);
  const [studentSubjects, setStudentSubjects] = useState<{ id: string; name: string; notOffering: boolean }[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [subjectListName, setSubjectListName] = useState("");

  async function handleConfirmPasswordReset() {
    if (!resetModalStudent) return;
    setResettingPassword(true);
    try {
      const res = await fetch("/api/admin/students/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ student_id: resetModalStudent.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to reset password.");
      }
      setResetResult({
        temporaryPassword: data.temporary_password,
        studentName: resetModalStudent.name,
        admissionNo: resetModalStudent.admission_no,
        email: data.email,
      });
      setResetModalStudent(null);
    } catch (err: any) {
      alert("Error resetting password: " + err.message);
    } finally {
      setResettingPassword(false);
    }
  }

  async function handleOpenSubjectModal(s: StudentRecord) {
    setSubjectModalStudent(s);
    setStudentSubjects([]);
    setSubjectListName("");
    setLoadingSubjects(true);
    try {
      const classId = (s as any).class_id || (s as any).current_class_id;
      const [{ data: cls }, { data: settings }] = await Promise.all([
        supabase.from("classes").select("subject_group_code, subject_groups(name)").eq("id", classId).maybeSingle(),
        supabase.from("app_settings").select("current_session").limit(1).maybeSingle(),
      ]);
      const groupCode = (cls as any)?.subject_group_code;
      setSubjectListName((cls as any)?.subject_groups?.name || "");
      if (!groupCode) return;

      const [{ data: list }, { data: optouts }] = await Promise.all([
        supabase
          .from("subject_group_subjects")
          .select("subject_id, display_order, subjects(name)")
          .eq("group_code", groupCode)
          .order("display_order"),
        supabase
          .from("student_subject_optouts")
          .select("subject_id")
          .eq("student_id", s.id)
          .eq("session", (settings as any)?.current_session || ""),
      ]);
      const off = new Set((optouts || []).map((o: any) => o.subject_id));
      setStudentSubjects(
        (list || []).map((l: any) => ({ id: l.subject_id, name: l.subjects?.name || "Subject", notOffering: off.has(l.subject_id) }))
      );
    } catch (err) {
      console.error("Failed to load student subjects:", err);
    } finally {
      setLoadingSubjects(false);
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: classesData } = await supabase
        .from("classes")
        .select("id, name")
        .order("name", { ascending: true });

      let finalStudentsData: any[] = [];
      const resCanonical = await supabase
        .from("students")
        .select("id, full_name, gender, admission_no, current_class_id, portal_access_status, portal_lock_reason, classes:current_class_id(id, name), users(email)")
        .order("full_name", { ascending: true });

      if (!resCanonical.error && resCanonical.data) {
        finalStudentsData = resCanonical.data.map((s: any) => ({
          ...s,
          name: s.full_name,
          class_id: s.current_class_id,
          classes: s.classes,
        }));
      } else {
        const resLegacy = await supabase
          .from("students")
          .select("id, name, gender, admission_no, class_id, portal_access_status, portal_lock_reason, classes:class_id(id, name), users(email)")
          .order("name", { ascending: true });
        if (resLegacy.error) throw resCanonical.error || resLegacy.error;
        finalStudentsData = resLegacy.data || [];
      }

      setClasses(classesData || []);
      setStudents(finalStudentsData);
    } catch (err) {
      console.error("Failed to load students:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleOpenModal(student?: StudentRecord) {
    setFormError("");
    if (student) {
      setEditingStudent(student);
      setFormData({
        name: student.name || "",
        admission_no: student.admission_no || "",
        class_id: student.class_id || "",
        gender: (student as any).gender === "female" ? "female" : (student as any).gender === "male" ? "male" : "",
        email: student.users?.email || "",
        password: "",
      });
    } else {
      setEditingStudent(null);
      setFormData({
        name: "",
        admission_no: "",
        class_id: "",
        gender: "",
        email: "",
        password: "gracemark",
      });
    }
    setIsModalOpen(true);
  }

  async function handleSaveStudent(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);

    const { name, admission_no, class_id, gender, email, password } = formData;

    if (!name.trim() || !admission_no.trim() || !class_id || !gender) {
      setFormError("Name, Admission Number, Class and Gender are required.");
      setSaving(false);
      return;
    }

    try {
      if (editingStudent) {
        // Update existing student
        const { error: updErr } = await supabase
          .from("students")
          .update({
            full_name: name.trim(),
            current_class_id: class_id,
            admission_no: admission_no.trim(),
            gender,
          })
          .eq("id", editingStudent.id);

        if (updErr) {
          const { error: legErr } = await supabase
            .from("students")
            .update({
              name: name.trim(),
              class_id,
              admission_no: admission_no.trim(),
              gender,
            })
            .eq("id", editingStudent.id);
          if (legErr) throw updErr || legErr;
        }

        // If a new password was provided during edit, update their auth password
        if (password.trim()) {
          const authEmail = email.trim() || `${admission_no.trim().replace(/[^A-Z0-9]/gi, "").toLowerCase()}@student.gracemark.edu.ng`;
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData?.session?.access_token;
          if (token) {
            await fetch("/api/admin/create-auth-user", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                email: authEmail,
                password: password.trim(),
                name: name.trim(),
                role: "student",
              }),
            });
          }
        }
      } else {
        // Create new student with automatic default password 'gracemark'
        const studentPassword = password.trim() || "gracemark";
        const cleanAdm = admission_no.trim().replace(/[^A-Z0-9]/gi, "").toLowerCase();
        const authEmail = email.trim() || `${cleanAdm}@student.gracemark.edu.ng`;
        let targetDbUserId: string | null = null;
        let authUserId: string | null = null;

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        if (token) {
          const res = await fetch("/api/admin/create-auth-user", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              email: authEmail,
              password: studentPassword,
              name: name.trim(),
              role: "student",
            }),
          });

          if (res.ok) {
            const resJson = await res.json();
            authUserId = resJson.user?.id || null;
            targetDbUserId = resJson.user?.dbUserId || null;
          } else {
            const errJson = await res.json();
            console.warn("Could not create auth user via API:", errJson);
          }
        }

        if (!targetDbUserId && authUserId) {
          const { data: uRow } = await supabase
            .from("users")
            .upsert(
              {
                auth_id: authUserId,
                email: authEmail,
                display_name: name.trim(),
                role: "student",
                status: "active",
                must_change_password: true,
              },
              { onConflict: "auth_id" }
            )
            .select("id")
            .single();
          targetDbUserId = uRow?.id || null;
        }

        if (!targetDbUserId) {
          const { data: existingUser } = await supabase
            .from("users")
            .select("id")
            .eq("email", authEmail)
            .maybeSingle();
          targetDbUserId = existingUser?.id || null;
        }

        if (!targetDbUserId) {
          throw new Error("Could not provision or link student user account in users table. Please ensure admin session is active.");
        }

        const { error: insErr } = await supabase.from("students").insert([
          {
            full_name: name.trim(),
            name: name.trim(),
            admission_no: admission_no.trim(),
            current_class_id: class_id,
            class_id: class_id,
            user_id: targetDbUserId,
            portal_access_status: "active",
            gender,
          },
        ]);

        if (insErr) {
          throw insErr;
        }
      }

      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      console.error("Save student error:", err);
      setFormError(err.message || "Failed to save student record.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteStudent(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete student "${name}"? All related results will be permanently removed.`)) {
      return;
    }

    try {
      const { error } = await supabase.from("students").delete().eq("id", id);
      if (error) throw error;
      loadData();
    } catch (err: any) {
      console.error("Delete student error:", err);
      alert(`Could not delete student: ${err.message}`);
    }
  }

  function handleDownloadTemplate() {
    const templateData = [
      {
        "Name": "Chinedu David Eze",
        "Class": "JSS 1",
        "Gender": "Male",
        "Admission Number": "GMA202501"
      },
      {
        "Name": "Amina Fatima Bello",
        "Class": "JSS 1",
        "Gender": "Female",
        "Admission Number": "GMA202502"
      },
      {
        "Name": "Oluwaseun Michael Adeyemi",
        "Class": "JSS 2",
        "Gender": "Male",
        "Admission Number": "GMA202411"
      },
      {
        "Name": "Godwin Ifeanyi Nwosu",
        "Class": "SSS 1 Science",
        "Gender": "Male",
        "Admission Number": "GMA202301"
      },
      {
        "Name": "Grace Chiamaka Peters",
        "Class": "SSS 2 Arts",
        "Gender": "Female",
        "Admission Number": "GMA202212"
      },
      {
        "Name": "Ayomide Temitope Olatunji",
        "Class": "SSS 2 Commercial",
        "Gender": "Female",
        "Admission Number": "GMA202221"
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");
    XLSX.writeFile(workbook, "Gracemark_Students_Template.xlsx");
  }

  async function handleBulkUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBulkUploading(true);
    setBulkMsg("Processing file…");

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(worksheet);

      if (!rows.length) {
        throw new Error("Uploaded spreadsheet is empty.");
      }

      // Normalization map for classes (e.g. "JSS 1", "JSS1", "SS 1 Science", "SSS 1 Science")
      const normalizeClassName = (str: string) =>
        str
          .toLowerCase()
          .replace(/\./g, "")
          .replace(/\s+/g, "")
          .replace(/^ss([123])/, "sss$1")
          .replace(/^js([123])/, "jss$1");

      const classMap = new Map<string, string>();
      classes.forEach((c) => {
        classMap.set(c.name.trim().toLowerCase(), c.id);
        classMap.set(normalizeClassName(c.name), c.id);
      });

      const newStudents: any[] = [];
      const unmappedRows: string[] = [];
      const missingGender: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name =
          row["Name"] ||
          row["Student Name"] ||
          row["Full Name"] ||
          row["name"] ||
          "";
        const admission_no =
          row["Admission Number"] ||
          row["Admission No"] ||
          row["Reg No"] ||
          row["admission_no"] ||
          row["Registration Number"] ||
          "";
        const className =
          row["Class"] ||
          row["Class Name"] ||
          row["class"] ||
          "";
        const genderRaw = String(row["Gender"] || row["Sex"] || row["gender"] || "").trim().toLowerCase();
        const gender = ["m", "male", "boy"].includes(genderRaw) ? "male" : ["f", "female", "girl"].includes(genderRaw) ? "female" : null;

        if (name && admission_no) {
          const cleanAdm = String(admission_no).trim();
          const cleanName = String(name).trim();
          const cleanClassRaw = String(className).trim();

          const classId =
            classMap.get(cleanClassRaw.toLowerCase()) ||
            classMap.get(normalizeClassName(cleanClassRaw)) ||
            null;

          if (!classId && cleanClassRaw) {
            unmappedRows.push(`Row ${i + 2}: "${cleanClassRaw}"`);
          }

          if (!gender) missingGender.push(`Row ${i + 2} (${cleanName})`);
          newStudents.push({
            name: cleanName,
            admission_no: cleanAdm,
            class_id: classId,
            gender,
          });
        }
      }

      if (!newStudents.length) {
        throw new Error("No valid student rows found. Expected columns: Name, Class, Gender, Admission Number.");
      }

      if (missingGender.length) {
        throw new Error(
          `Gender is missing or not Male/Female for ${missingGender.length} student(s): ${missingGender.slice(0, 5).join(", ")}. Add a "Gender" column with Male or Female.`
        );
      }

      const missingClasses = newStudents.filter((s) => !s.class_id);
      if (missingClasses.length > 0) {
        const sampleErrors = unmappedRows.slice(0, 3).join(", ");
        throw new Error(
          `${missingClasses.length} student(s) have unassigned or unrecognized class names (${sampleErrors}). Available classes: ${classes.map((c) => c.name).join(", ")}`
        );
      }

      // New students get a login (like Add Student); existing ones are updated.
      setBulkMsg(`Importing ${newStudents.length} students… this can take a minute.`);
      const res = await fetch("/api/admin/students/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ rows: newStudents }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || "Import request failed.");

      const parts = [
        result.created.length ? `${result.created.length} new student(s) added with portal logins (default password "${result.defaultPassword}")` : "",
        result.updated.length ? `${result.updated.length} existing student(s) updated` : "",
      ].filter(Boolean);
      const failures = result.failed.length
        ? ` ${result.failed.length} failed: ${result.failed.slice(0, 5).map((f: any) => `${f.row}: ${f.reason}`).join("; ")}${result.failed.length > 5 ? "…" : ""}`
        : "";
      setBulkMsg(result.failed.length && !parts.length ? `Import failed.${failures}` : `${parts.join(", ")}.${failures}`);
      loadData();
    } catch (err: any) {
      console.error("Bulk upload error:", err);
      setBulkMsg(`Import failed: ${err.message || "Unknown error"}`);
    } finally {
      setBulkUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => setBulkMsg(""), 6000);
    }
  }

  const filteredStudents = students.filter((s) => {
    if (selectedClass && s.class_id !== selectedClass) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = (s.name || "").toLowerCase().includes(q);
      const matchAdm = (s.admission_no || "").toLowerCase().includes(q);
      return matchName || matchAdm;
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top action toolbar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Students Roster
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage student records, admission numbers, class enrollment, and accounts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Download Template */}
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Download Excel spreadsheet template"
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
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            <span>Add Student</span>
          </button>
        </div>
      </div>

      {bulkMsg && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold ${
            bulkMsg.startsWith("Import failed")
              ? "bg-rose-50 text-rose-700 border border-rose-200"
              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          {bulkMsg}
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by student name or admission number…"
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
          />
        </div>

        <div className="w-full sm:w-56 shrink-0">
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
          >
            <option value="">All Classes ({students.length})</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Students Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3.5">Student</th>
                <th className="px-4 py-3.5">Admission No</th>
                <th className="px-4 py-3.5">Class</th>
                <th className="px-4 py-3.5">Portal Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    Loading student roster…
                  </td>
                </tr>
              ) : filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    No students match your filter.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3.5 font-bold text-slate-900">
                      <div>{s.name}</div>
                      {s.users?.email && (
                        <div className="text-[10px] text-slate-400 font-normal">{s.users.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-600 font-medium">
                      {s.admission_no}
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-800">
                      {s.classes?.name || "Unassigned"}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                          s.portal_access_status === "LOCKED"
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {s.portal_access_status === "LOCKED" ? "Locked" : "Active"}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleOpenSubjectModal(s)}
                        className="text-emerald-600 hover:text-emerald-800 font-semibold cursor-pointer"
                        title="View this student's subjects"
                      >
                        Subjects
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResetModalStudent(s);
                          setResetResult(null);
                          setCopiedPass(false);
                        }}
                        className="text-amber-600 hover:text-amber-800 font-semibold cursor-pointer"
                        title="Generate temporary password"
                      >
                        Reset Pass
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenModal(s)}
                        className="text-indigo-600 hover:text-indigo-900 font-semibold cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteStudent(s.id, s.name)}
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

      {/* Add / Edit Student Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 tracking-tight">
                {editingStudent ? "Edit Student Record" : "Add New Student"}
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

            <form onSubmit={handleSaveStudent} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. John Doe"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Admission Number *
                </label>
                <input
                  type="text"
                  required
                  value={formData.admission_no}
                  onChange={(e) => setFormData({ ...formData, admission_no: e.target.value })}
                  placeholder="e.g. GM/2024/001"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">
                  Class Assignment *
                </label>
                <select
                  required
                  value={formData.class_id}
                  onChange={(e) => setFormData({ ...formData, class_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white text-xs"
                >
                  <option value="">Select Class</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="block font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-1">Gender *</span>
                <div className="flex gap-2" role="radiogroup" aria-label="Gender">
                  {(["male", "female"] as const).map((g) => (
                    <label
                      key={g}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                        formData.gender === g ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-white"
                      }`}
                    >
                      <input
                        type="radio"
                        name="gender"
                        value={g}
                        checked={formData.gender === g}
                        onChange={() => setFormData({ ...formData, gender: g })}
                        className="sr-only"
                        required
                      />
                      {g === "male" ? "Male" : "Female"}
                    </label>
                  ))}
                </div>
              </div>

              {!editingStudent && (
                <div className="pt-3 border-t border-slate-100 space-y-3">
                  <div className="text-[11px] font-bold text-slate-700">
                    Automatic Portal Account Setup
                  </div>
                  <div>
                    <label className="block font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-1">
                      Portal Login Password (Default: gracemark)
                    </label>
                    <input
                      type="text"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="gracemark"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      The student will sign in using their Admission Number and password: <strong className="text-slate-800 font-mono">gracemark</strong>
                    </p>
                  </div>
                </div>
              )}

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
                  {saving ? "Saving…" : "Save Student"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Reset Confirmation Modal */}
      {resetModalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-slate-200">
            <div className="flex items-center gap-3 text-amber-600 mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center font-bold text-lg">
                Temporary password
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 tracking-tight">Reset Password</h3>
                <p className="text-xs text-slate-500 font-medium">Issue temporary credentials</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Reset password for <strong className="text-slate-900">{resetModalStudent.name}</strong> (Adm No:{" "}
              <strong className="font-mono text-slate-900">{resetModalStudent.admission_no}</strong>)?
              <br /><br />
              This will generate a randomized temporary password and require the student to set their own personal password on next login.
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setResetModalStudent(null)}
                disabled={resettingPassword}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPasswordReset}
                disabled={resettingPassword}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-xs cursor-pointer disabled:opacity-50"
              >
                {resettingPassword ? "Generating…" : "Generate New Password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Temporary Password Result Modal */}
      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-slate-200">
            <div className="flex items-center gap-3 text-emerald-600 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center font-bold text-lg">
                ✅
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 tracking-tight">Password Reset Complete</h3>
                <p className="text-xs text-slate-500 font-medium">Share credentials with student / parent</p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 mb-4 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Student:</span>
                <span className="font-bold text-slate-900">{resetResult.studentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Admission / Login ID:</span>
                <span className="font-mono font-bold text-slate-900">{resetResult.admissionNo}</span>
              </div>
              {resetResult.email && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Auth Email:</span>
                  <span className="font-mono text-slate-700">{resetResult.email}</span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Temporary Password
                </span>
                <div className="flex items-center justify-between bg-white border border-amber-300 rounded-lg p-2 px-3">
                  <span className="font-mono font-bold text-amber-700 text-sm tracking-wider">
                    {resetResult.temporaryPassword}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `Gracemark Academy Portal Login:\nLogin ID: ${resetResult.admissionNo}\nTemporary Password: ${resetResult.temporaryPassword}\nNote: You will be asked to change this password upon logging in.`
                      );
                      setCopiedPass(true);
                      setTimeout(() => setCopiedPass(false), 2500);
                    }}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer ml-2"
                  >
                    {copiedPass ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-4">
              <strong>Forced Change:</strong> The student must set their own secure password immediately upon logging in with this temporary code.
            </p>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setResetResult(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer shadow-xs"
              >
                Close & Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Student Subjects (read-only) */}
      {subjectModalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-base text-slate-900">Subjects</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="font-semibold text-slate-800">{subjectModalStudent.name}</span> &bull;{" "}
                  {subjectModalStudent.classes?.name || "No class"}
                  {subjectListName ? ` · ${subjectListName} list` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubjectModalStudent(null)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none cursor-pointer"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="overflow-y-auto py-3 flex-1">
              {loadingSubjects ? (
                <p className="text-xs text-slate-400 py-6 text-center">Loading…</p>
              ) : studentSubjects.length === 0 ? (
                <p className="text-xs text-amber-700 py-6 text-center">
                  This class has no subject list yet. Set it up under Class Subject Lists.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {studentSubjects.map((sub) => (
                    <li key={sub.id} className="flex items-center justify-between py-2 text-sm">
                      <span className={sub.notOffering ? "text-slate-400 line-through" : "text-slate-800 font-medium"}>{sub.name}</span>
                      {sub.notOffering && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          Not offering
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-[11px] text-slate-500 pt-3 border-t border-slate-100">
              Subjects follow the class. To switch track (e.g. Arts to Science), edit the student and change the class. Subject
              teachers mark &ldquo;Not offering&rdquo; in score entry.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
