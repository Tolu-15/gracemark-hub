"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { resolveStudentUserIdCandidates } from "@/lib/auth";
import { getAppSettings } from "@/lib/appSettings";
import ResultDashboardApp from "@/components/student/ResultDashboardApp";

export default function StudentResultPage() {
  const router = useRouter();
  const [student, setStudent] = useState<any>(null);
  const [session, setSession] = useState("");
  const [term, setTerm] = useState("term1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.push("/");
          return;
        }

        const candidateIds = await resolveStudentUserIdCandidates(user.id);
        const { data: studentRecord, error: stdErr } = await supabase
          .from("students")
          .select("id, admission_no, name, class_id, classes(name)")
          .in("user_id", candidateIds)
          .maybeSingle();

        if (stdErr) throw stdErr;

        if (!studentRecord) {
          throw new Error("Student profile record not found. Please contact administration.");
        }

        const settings = await getAppSettings();
        if (settings?.current_session) setSession(settings.current_session);
        if (settings?.current_term) setTerm(settings.current_term);

        setStudent(studentRecord);
      } catch (err: any) {
        console.error("Student result init error:", err);
        setError(err.message || "Failed to load report sheet.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-white z-50 flex flex-col items-center justify-center">
        <div className="flex items-center gap-3 mb-2">
          <img src="/assets/icons/logo.jpg" alt="Logo" className="w-8 h-8 rounded-lg object-cover" />
          <span className="font-bold text-slate-900 text-lg tracking-tight">Gracemark Academy</span>
        </div>
        <p className="text-sm font-medium text-slate-500 animate-pulse">Loading academic report sheet...</p>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <div className="text-center p-6 max-w-md bg-white rounded-xl border border-rose-200 shadow-sm">
          <p className="text-rose-600 font-semibold mb-3">{error || "Student record not found."}</p>
          <button
            onClick={() => router.push("/student/dashboard")}
            className="inline-block px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <ResultDashboardApp
        student={student}
        initialTerm={term}
        initialSession={session}
        onClose={() => router.push("/student/dashboard")}
      />
    </div>
  );
}
