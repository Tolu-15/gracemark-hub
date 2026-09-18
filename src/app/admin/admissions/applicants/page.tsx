"use client";

import React, { useState, useEffect } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { supabase } from "@/lib/supabase/client";
import { formatDate } from "@/lib/schoolFinance";

interface ClassOption {
  id: string;
  name: string;
}

interface AdmissionApplicant {
  id: string;
  surname: string;
  first_names: string;
  admission_number?: string | null;
  desired_class: string;
  parent_guardian_email?: string | null;
  parent_guardian_phone?: string | null;
  parent_guardian_name?: string | null;
  parent_guardian_occupation?: string | null;
  application_status: string;
  created_at: string;
  gender?: string | null;
  date_of_birth?: string | null;
  state_of_origin?: string | null;
  home_address?: string | null;
  previous_school_name?: string | null;
  previous_class?: string | null;
  is_boarding?: boolean | null;
  boarding_type?: string | null;
  medical_conditions?: string | null;
}

export default function AdminAdmissionsApplicantsPage() {
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [applicants, setApplicants] = useState<AdmissionApplicant[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // Modal State
  const [selectedApplicant, setSelectedApplicant] = useState<AdmissionApplicant | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStatus, setModalStatus] = useState("submitted");
  const [savingStatus, setSavingStatus] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [classRes, appRes] = await Promise.all([
        supabase.from("classes").select("id, name").order("name"),
        supabase.from("admissions").select("*").order("created_at", { ascending: false }),
      ]);

      setClasses(classRes.data || []);
      setApplicants((appRes.data as any) || []);
    } catch (err: any) {
      console.error("Error loading applicants:", err);
      alert("Failed to load applicants: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredApplicants = applicants.filter((a) => {
    if (filterClass && a.desired_class !== filterClass) return false;
    if (filterStatus && a.application_status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = `${a.surname || ""} ${a.first_names || ""}`.toLowerCase().includes(q);
      const matchRef = String(a.admission_number || "").toLowerCase().includes(q);
      const matchEmail = String(a.parent_guardian_email || "").toLowerCase().includes(q);
      if (!matchName && !matchRef && !matchEmail) return false;
    }
    return true;
  });

  const openApplicantModal = (applicant: AdmissionApplicant) => {
    setSelectedApplicant(applicant);
    setModalStatus(applicant.application_status || "submitted");
    setIsModalOpen(true);
  };

  const handleSaveStatus = async () => {
    if (!selectedApplicant) return;
    setSavingStatus(true);
    try {
      const { error } = await supabase
        .from("admissions")
        .update({
          application_status: modalStatus,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", selectedApplicant.id);

      if (error) throw error;

      setIsModalOpen(false);
      await loadData();
    } catch (err: any) {
      alert("Failed to update status: " + err.message);
    } finally {
      setSavingStatus(false);
    }
  };

  const getBadgeClass = (status: string) => {
    switch (status) {
      case "approved":
        return "bg-emerald-50 text-emerald-700 font-semibold";
      case "submitted":
        return "bg-blue-50 text-blue-700 font-semibold";
      case "under_review":
        return "bg-amber-50 text-amber-700 font-semibold";
      case "rejected":
        return "bg-rose-50 text-rose-700 font-semibold";
      default:
        return "bg-slate-100 text-slate-700 font-semibold";
    }
  };

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shrink-0">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Admission Applicants</h1>
            <p className="text-xs text-slate-500">
              Track candidates who purchased online admission forms and review applications.
            </p>
          </div>
        </header>

        <div className="p-6 max-w-7xl mx-auto w-full space-y-6 flex-1 overflow-y-auto">
          {/* Filters Toolbar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search applicant name, email, or ref..."
                className="px-3 py-2 border border-slate-300 rounded-lg text-xs w-full sm:w-64 outline-none focus:border-slate-500"
              />
              <select
                value={filterClass}
                onChange={(e) => setFilterClass(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none"
              >
                <option value="">All Desired Classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none"
              >
                <option value="">All Application Statuses</option>
                <option value="submitted">Submitted</option>
                <option value="under_review">Under Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          {/* Applicants Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-5 py-3.5">Candidate</th>
                    <th className="px-5 py-3.5">Admission Ref</th>
                    <th className="px-5 py-3.5">Desired Class</th>
                    <th className="px-5 py-3.5">Parent Email & Phone</th>
                    <th className="px-5 py-3.5 text-center">Status</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        Loading applicants...
                      </td>
                    </tr>
                  ) : filteredApplicants.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        No applicants found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredApplicants.map((a) => {
                      const name = `${a.surname} ${a.first_names}`;
                      return (
                        <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-5 py-3.5">
                            <span className="font-bold text-slate-900 block">{name}</span>
                            <span className="text-[11px] text-slate-400">Applied: {formatDate(a.created_at)}</span>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-slate-900 font-semibold">
                            {a.admission_number || "—"}
                          </td>
                          <td className="px-5 py-3.5 font-medium text-slate-700">{a.desired_class}</td>
                          <td className="px-5 py-3.5 text-slate-600">
                            <span className="block">{a.parent_guardian_email || "—"}</span>
                            <span className="text-[11px] text-slate-400 font-mono">
                              {a.parent_guardian_phone || "—"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <span className={`px-2.5 py-1 rounded text-[11px] uppercase ${getBadgeClass(a.application_status)}`}>
                              {a.application_status}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              onClick={() => openApplicantModal(a)}
                              className="px-3 py-1.5 bg-slate-900 text-white font-semibold text-xs rounded-lg hover:bg-slate-800 transition-colors"
                            >
                              View Profile
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

        {/* Applicant Profile Detail Modal */}
        {isModalOpen && selectedApplicant && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-2xl w-full p-6 border border-slate-200 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    {selectedApplicant.surname} {selectedApplicant.first_names}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">{selectedApplicant.admission_number || "ADM-PENDING"}</p>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 font-bold text-lg"
                >
                  &times;
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-100">
                  <h4 className="font-bold text-slate-900 uppercase text-[10px] text-slate-400 tracking-wider">
                    Personal Information
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500">Gender:</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {selectedApplicant.gender === "M" ? "Male" : selectedApplicant.gender === "F" ? "Female" : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Date of Birth:</span>{" "}
                      <span className="font-semibold text-slate-800">{formatDate(selectedApplicant.date_of_birth)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">State of Origin:</span>{" "}
                      <span className="font-semibold text-slate-800">{selectedApplicant.state_of_origin || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Home Address:</span>{" "}
                      <span className="font-semibold text-slate-800">{selectedApplicant.home_address || "—"}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-100">
                  <h4 className="font-bold text-slate-900 uppercase text-[10px] text-slate-400 tracking-wider">
                    Educational Background
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500">Previous School:</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {selectedApplicant.previous_school_name || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Previous Class:</span>{" "}
                      <span className="font-semibold text-slate-800">{selectedApplicant.previous_class || "—"}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-100">
                  <h4 className="font-bold text-slate-900 uppercase text-[10px] text-slate-400 tracking-wider">
                    Parent / Guardian Information
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500">Parent Name:</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {selectedApplicant.parent_guardian_name || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Phone:</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {selectedApplicant.parent_guardian_phone || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Email:</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {selectedApplicant.parent_guardian_email || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Occupation:</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {selectedApplicant.parent_guardian_occupation || "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-100">
                  <h4 className="font-bold text-slate-900 uppercase text-[10px] text-slate-400 tracking-wider">
                    Accommodation & Medical
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500">Boarding Status:</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {selectedApplicant.is_boarding
                          ? `Boarding (${selectedApplicant.boarding_type || "Full"})`
                          : "Day Student"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Medical Notes:</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {selectedApplicant.medical_conditions || "None reported"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">Update Status:</span>
                  <select
                    value={modalStatus}
                    onChange={(e) => setModalStatus(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="submitted">Submitted</option>
                    <option value="under_review">Under Review</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <button
                  onClick={handleSaveStatus}
                  disabled={savingStatus}
                  className="px-5 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
                >
                  {savingStatus ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
