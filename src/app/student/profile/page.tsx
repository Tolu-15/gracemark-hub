"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/schoolFinance";

export default function StudentProfilePage() {
  const router = useRouter();
  const [student, setStudent] = useState<any>(null);
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.push("/");
          return;
        }

        setUserEmail(user.email || "");

        let { data: std } = await supabase
          .from("students")
          .select("*, classes(name)")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!std) {
          const { data: altStd } = await supabase
            .from("students")
            .select("*, classes(name)")
            .eq("id", user.id)
            .maybeSingle();
          std = altStd;
        }

        setStudent(std);
      } catch (err) {
        console.error("Student profile load error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-sm font-medium text-slate-500">Loading student profile...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Student Profile</h1>
          <p className="text-xs text-slate-500">Official student biographical and institutional records.</p>
        </div>
      </header>

      <div className="p-6 max-w-4xl mx-auto w-full space-y-6 flex-1">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-8">
          {/* Header Card */}
          <div className="flex flex-wrap items-center gap-5 border-b border-slate-100 pb-6">
            <div className="w-20 h-20 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-2xl shadow-md">
              {student?.name?.charAt(0) || "S"}
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900">{student?.name || "Student"}</h2>
              <p className="text-xs font-mono text-slate-500 mt-0.5">
                Admission No: {student?.admission_no || "—"}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full text-xs font-bold">
                  {student?.classes?.name || "Unassigned"}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold uppercase ${
                    student?.portal_access_status === "LOCKED"
                      ? "bg-rose-100 text-rose-800"
                      : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  Portal: {student?.portal_access_status || "ACTIVE"}
                </span>
              </div>
            </div>
          </div>

          {/* Academic Information */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
              Institutional Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-1">Enrolled Class</span>
                <span className="font-bold text-slate-900 text-sm">{student?.classes?.name || "—"}</span>
              </div>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-1">Official Student ID</span>
                <span className="font-mono font-bold text-slate-900 text-sm">{student?.admission_no || "—"}</span>
              </div>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-1">Admission Date</span>
                <span className="font-bold text-slate-900 text-sm">{formatDate(student?.created_at)}</span>
              </div>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-1">Graduation / Alumni Status</span>
                <span className="font-bold text-slate-900 text-sm">
                  {student?.is_alumni ? "Graduated (Alumni)" : "Active Student"}
                </span>
              </div>
            </div>
          </div>

          {/* Guardian / Contact Information */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
              Guardian &amp; Emergency Contact
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-1">Guardian Name</span>
                <span className="font-bold text-slate-900 text-sm">{student?.guardian_name || "—"}</span>
              </div>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-1">Guardian Phone</span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  {student?.guardian_phone || "—"}
                </span>
              </div>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 sm:col-span-2">
                <span className="text-slate-400 block mb-1">Residential Address</span>
                <span className="font-medium text-slate-800 text-sm">{student?.address || "—"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
