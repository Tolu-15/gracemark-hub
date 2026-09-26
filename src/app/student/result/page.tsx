"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { resolveStudentUserIdCandidates } from "@/lib/auth";
import { getAppSettings } from "@/lib/appSettings";
import { Skeleton, SkeletonValue } from "@/components/shared/Skeleton";
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
          .select("id, admission_no, name, class_id, classes:class_id(name)")
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
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-5" role="status" aria-label="Loading report sheet">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton block className="h-6 w-56" />
            <Skeleton block className="h-3 w-36" />
          </div>
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <Skeleton block className="h-3 w-16" />
              <Skeleton block className="h-6 w-20" />
            </div>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-6" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
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
