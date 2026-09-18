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

  // Bulk upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");

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
        password: "",
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
      } else {
        // Create new student
        let authUserId: string | null = null;

        // Provision Auth User if email + password or admission_no + password provided
        if (password) {
          const authEmail = email.trim() || `${admission_no.trim().replace(/[^A-Z0-9]/gi, "").toLowerCase()}@student.gracemark.edu.ng`;
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
                password,
              }),
            });

            if (res.ok) {
              const resJson = await res.json();
              authUserId = resJson.user?.id || null;

              if (authUserId) {
                // Insert profile into users table
                await supabase.from("users").upsert({
                  auth_id: authUserId,
                  email: authEmail,
                  display_name: name.trim(),
                  role: "student",
                });
              }
            }
          }
        }

        const { error } = await supabase.from("students").insert([
          {
            name: name.trim(),
            admission_no: admission_no.trim(),
            class_id,
            user_id: authUserId,
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

      // Find class map
      const classMap = new Map<string, string>();
      classes.forEach((c) => classMap.set(c.name.trim().toLowerCase(), c.id));

      const newStudents = [];
      for (const row of rows) {
        const name = row["Name"] || row["Student Name"] || row["Full Name"] || "";
        const admission_no = row["Admission No"] || row["Admission Number"] || row["Reg No"] || "";
        const className = row["Class"] || row["Class Name"] || "";

        if (name && admission_no) {
          const classId = classMap.get(String(className).trim().toLowerCase()) || null;
          newStudents.push({
            name: String(name).trim(),
            admission_no: String(admission_no).trim(),
            class_id: classId,
            portal_access_status: "ACTIVE",
          });
        }
      }

      if (!newStudents.length) {
        throw new Error("No valid student rows found. Expected columns: Name, Admission No, Class.");
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
      setTimeout(() => setBulkMsg(""), 5000);
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
                  <div className="text-[11px] font-bold text-slate-600">
                    Optional Portal Account Setup
                  </div>
                  <div>
                    <label className="block font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-1">
                      Initial Password
                    </label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="Leave blank to skip account creation"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white"
                    />
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
    </div>
  );
}
