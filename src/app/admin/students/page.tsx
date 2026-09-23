"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase/client";
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

  // Subject Enrollment modal states
  const [subjectModalStudent, setSubjectModalStudent] = useState<StudentRecord | null>(null);
  const [subjectConfigs, setSubjectConfigs] = useState<Record<string, { status: "enrolled" | "dropped" | "exempted"; notes?: string }>>({});
  const [availableSubjects, setAvailableSubjects] = useState<{ id: string; name: string }[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [savingSubjects, setSavingSubjects] = useState(false);
  const [subjectModalMsg, setSubjectModalMsg] = useState("");
  const [syncingJss, setSyncingJss] = useState(false);

  async function handleConfirmPasswordReset() {
    if (!resetModalStudent) return;
    setResettingPassword(true);
    try {
      const res = await fetch("/api/admin/students/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    setSubjectModalMsg("");
    setLoadingSubjects(true);
    try {
      // 1. Load all available subjects
      const { data: subs } = await supabase.from("subjects").select("id, name").order("name");
      setAvailableSubjects(subs || []);

      // 2. Load existing enrollments for this student
      const res = await fetch(`/api/admin/students/subject-enrollments?studentId=${s.id}`);
      if (res.ok) {
        const json = await res.json();
        if (json.ok && json.enrollments) {
          const map: Record<string, { status: "enrolled" | "dropped" | "exempted"; notes?: string }> = {};
          json.enrollments.forEach((e: any) => {
            map[e.subject_id] = { status: e.status || "enrolled", notes: e.notes || "" };
          });
          setSubjectConfigs(map);
        }
      }
    } catch (err: any) {
      console.error("Failed to load subject enrollments:", err);
    } finally {
      setLoadingSubjects(false);
    }
  }

  async function handleApplyTrackDefaults() {
    if (!subjectModalStudent) return;
    const className = subjectModalStudent.classes?.name || "";
    try {
      const res = await fetch("/api/admin/students/subject-enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get-track-defaults", className }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          const newMap = { ...subjectConfigs };
          (json.core || []).forEach((c: { id: string }) => {
            newMap[c.id] = { status: "enrolled" };
          });
          (json.majors || []).forEach((m: { id: string }) => {
            newMap[m.id] = { status: "enrolled" };
          });
          setSubjectConfigs(newMap);
          setSubjectModalMsg("Loaded track default core & majors! Select any electives, then click Save.");
        }
      }
    } catch (err: any) {
      console.error("Error loading track defaults:", err);
    }
  }

  async function handleSaveSubjectEnrollments() {
    if (!subjectModalStudent) return;
    setSavingSubjects(true);
    setSubjectModalMsg("");
    try {
      const res = await fetch("/api/admin/students/subject-enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-student-subjects",
          studentId: subjectModalStudent.id,
          classId: subjectModalStudent.class_id,
          subjectStatuses: subjectConfigs,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save subject enrollments");
      setSubjectModalMsg("Subjects saved successfully!");
      setTimeout(() => {
        setSubjectModalStudent(null);
      }, 900);
    } catch (err: any) {
      setSubjectModalMsg(`Error: ${err.message}`);
    } finally {
      setSavingSubjects(false);
    }
  }

  async function handleSyncAllJss() {
    if (!confirm("This will auto-enroll all students in JSS 1, JSS 2, and JSS 3 into the standard JSS curriculum. Proceed?")) {
      return;
    }
    setSyncingJss(true);
    setBulkMsg("");
    try {
      const jssClasses = classes.filter((c) => /JSS/i.test(c.name));
      let totalEnrolled = 0;
      for (const jc of jssClasses) {
        const res = await fetch("/api/admin/students/subject-enrollments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "auto-enroll-jss", classId: jc.id }),
        });
        const d = await res.json();
        if (d.ok) totalEnrolled += d.enrolledStudentsCount || 0;
      }
      setBulkMsg(`Successfully synced standard JSS curriculum across ${jssClasses.length} junior classes!`);
    } catch (err: any) {
      setBulkMsg(`Failed to sync JSS subjects: ${err.message}`);
    } finally {
      setSyncingJss(false);
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: classesData }, { data: studentsData, error: sErr }] = await Promise.all([
        supabase.from("classes").select("id, name").order("name", { ascending: true }),
        supabase
          .from("students")
          .select("id, name, admission_no, class_id, portal_access_status, portal_lock_reason, classes(id, name), users(email)")
          .order("name", { ascending: true }),
      ]);

      if (sErr) throw sErr;

      setClasses(classesData || []);
      setStudents(studentsData || []);
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
        email: student.users?.email || "",
        password: "",
      });
    } else {
      setEditingStudent(null);
      setFormData({
        name: "",
        admission_no: "",
        class_id: "",
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

    const { name, admission_no, class_id, email, password } = formData;

    if (!name.trim() || !admission_no.trim() || !class_id) {
      setFormError("Name, Admission Number, and Class are required.");
      setSaving(false);
      return;
    }

    try {
      if (editingStudent) {
        // Update existing student
        const { error } = await supabase
          .from("students")
          .update({
            name: name.trim(),
            admission_no: admission_no.trim(),
            class_id,
          })
          .eq("id", editingStudent.id);

        if (error) throw error;

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

            if (authUserId) {
              await supabase.from("users").upsert({
                auth_id: authUserId,
                email: authEmail,
                display_name: name.trim(),
                role: "student",
                status: "active",
                must_change_password: false,
              });
            }
          } else {
            const errJson = await res.json();
            console.warn("Could not create auth user via API:", errJson);
          }
        }

        const fallbackUserId =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID
                ? window.crypto.randomUUID()
                : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c: any) =>
                    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
                  ));

        const { error } = await supabase.from("students").insert([
          {
            name: name.trim(),
            admission_no: admission_no.trim(),
            class_id,
            user_id: authUserId || fallbackUserId,
            portal_access_status: "ACTIVE",
          },
        ]);

        if (error) throw error;
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
        "Admission Number": "GMA202501"
      },
      {
        "Name": "Amina Fatima Bello",
        "Class": "JSS 1",
        "Admission Number": "GMA202502"
      },
      {
        "Name": "Oluwaseun Michael Adeyemi",
        "Class": "JSS 2",
        "Admission Number": "GMA202411"
      },
      {
        "Name": "Godwin Ifeanyi Nwosu",
        "Class": "SSS 1 Science",
        "Admission Number": "GMA202301"
      },
      {
        "Name": "Grace Chiamaka Peters",
        "Class": "SSS 2 Arts",
        "Admission Number": "GMA202212"
      },
      {
        "Name": "Ayomide Temitope Olatunji",
        "Class": "SSS 2 Commercial",
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

      // 1. Fetch existing students' admission_no -> user_id to preserve existing accounts
      const { data: existingStudents } = await supabase
        .from("students")
        .select("admission_no, user_id");
      const existingUserMap = new Map<string, string>();
      if (existingStudents) {
        existingStudents.forEach((s) => {
          if (s.admission_no && s.user_id) {
            existingUserMap.set(s.admission_no.trim().toLowerCase(), s.user_id);
          }
        });
      }

      // 2. Normalization map for classes (e.g. "JSS 1", "JSS1", "SS 1 Science", "SSS 1 Science")
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

          const existingUserId = existingUserMap.get(cleanAdm.toLowerCase());
          const userId =
            existingUserId ||
            (typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID
                  ? window.crypto.randomUUID()
                  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c: any) =>
                      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
                    )));

          newStudents.push({
            name: cleanName,
            admission_no: cleanAdm,
            class_id: classId,
            user_id: userId,
            portal_access_status: "ACTIVE",
          });
        }
      }

      if (!newStudents.length) {
        throw new Error("No valid student rows found. Expected columns: Name, Class, Admission Number.");
      }

      const missingClasses = newStudents.filter((s) => !s.class_id);
      if (missingClasses.length > 0) {
        const sampleErrors = unmappedRows.slice(0, 3).join(", ");
        throw new Error(
          `${missingClasses.length} student(s) have unassigned or unrecognized class names (${sampleErrors}). Available classes: ${classes.map((c) => c.name).join(", ")}`
        );
      }

      const { error } = await supabase
        .from("students")
        .upsert(newStudents, { onConflict: "admission_no" });

      if (error) throw error;

      setBulkMsg(`Successfully imported ${newStudents.length} students!`);
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

          {/* Sync JSS Subjects */}
          <button
            type="button"
            disabled={syncingJss}
            onClick={handleSyncAllJss}
            className="px-3.5 py-2 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Auto-enroll all JSS students into standard JSS curriculum"
          >
            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span>{syncingJss ? "Syncing JSS…" : "Sync JSS Subjects"}</span>
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
                        title="Manage Enrolled & Dropped Subjects"
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

      {/* Student Subject Enrollment Modal */}
      {subjectModalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-base text-slate-900 tracking-tight">
                  Subject Enrollment & Dropped Subjects
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="font-semibold text-slate-800">{subjectModalStudent.name}</span> &bull;{" "}
                  <span className="font-mono text-slate-600">{subjectModalStudent.admission_no}</span> &bull;{" "}
                  <span className="font-semibold text-indigo-600">{subjectModalStudent.classes?.name || "No Class"}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubjectModalStudent(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* Quick Actions Bar */}
            <div className="py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/50 -mx-6 px-6">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Preset Tools
              </span>
              <div className="flex items-center gap-2">
                {/JSS/i.test(subjectModalStudent.classes?.name || "") ? (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!subjectModalStudent.class_id) return;
                      setLoadingSubjects(true);
                      await fetch("/api/admin/students/subject-enrollments", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "auto-enroll-jss", classId: subjectModalStudent.class_id }),
                      });
                      await handleOpenSubjectModal(subjectModalStudent);
                    }}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs cursor-pointer"
                  >
                    Apply Standard JSS Curriculum
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleApplyTrackDefaults}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs cursor-pointer"
                  >
                    Load Track Defaults (Core + Majors)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const allEnrolled: Record<string, { status: "enrolled" }> = {};
                    availableSubjects.forEach((sub) => {
                      allEnrolled[sub.id] = { status: "enrolled" };
                    });
                    setSubjectConfigs(allEnrolled);
                  }}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-lg text-xs cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => setSubjectConfigs({})}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-lg text-xs cursor-pointer"
                >
                  Clear All
                </button>
              </div>
            </div>

            {subjectModalMsg && (
              <div
                className={`my-3 p-2.5 rounded-xl text-xs font-semibold ${
                  subjectModalMsg.startsWith("Error")
                    ? "bg-rose-50 text-rose-700 border border-rose-200"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                }`}
              >
                {subjectModalMsg}
              </div>
            )}

            {/* Subject List */}
            <div className="flex-1 overflow-y-auto py-2 divide-y divide-slate-100 text-xs">
              {loadingSubjects ? (
                <div className="p-8 text-center text-slate-400">Loading curriculum subjects…</div>
              ) : (
                availableSubjects.map((sub) => {
                  const cfg = subjectConfigs[sub.id];
                  const currentStatus = cfg?.status || "none";
                  return (
                    <div
                      key={sub.id}
                      className="py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 px-2 rounded-lg"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-slate-800">{sub.name}</span>
                        {currentStatus === "enrolled" && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Enrolled
                          </span>
                        )}
                        {currentStatus === "dropped" && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            Dropped
                          </span>
                        )}
                        {currentStatus === "exempted" && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            Exempted
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          value={currentStatus}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSubjectConfigs((prev) => {
                              const updated = { ...prev };
                              if (val === "none") {
                                delete updated[sub.id];
                              } else {
                                updated[sub.id] = {
                                  status: val as "enrolled" | "dropped" | "exempted",
                                  notes: prev[sub.id]?.notes,
                                };
                              }
                              return updated;
                            });
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
                            currentStatus === "enrolled"
                              ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                              : currentStatus === "dropped"
                              ? "bg-amber-50 text-amber-800 border-amber-300"
                              : currentStatus === "exempted"
                              ? "bg-slate-100 text-slate-700 border-slate-300"
                              : "bg-white text-slate-500 border-slate-200"
                          }`}
                        >
                          <option value="none">Not Enrolled</option>
                          <option value="enrolled">Enrolled (Active)</option>
                          <option value="dropped">Dropped (SSS)</option>
                          <option value="exempted">Exempted</option>
                        </select>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-2">
              <span className="text-xs text-slate-500 font-medium">
                {Object.values(subjectConfigs).filter((c) => c.status === "enrolled").length} enrolled subjects
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSubjectModalStudent(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingSubjects}
                  onClick={handleSaveSubjectEnrollments}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-xs cursor-pointer disabled:opacity-50 text-xs"
                >
                  {savingSubjects ? "Saving…" : "Save Subject Roster"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
