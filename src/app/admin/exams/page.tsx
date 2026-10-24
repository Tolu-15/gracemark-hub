"use client";

import React from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import ExamManager from "@/components/cbt/ExamManager";

export default function AdminExamsPage() {
  return (
    <AuthGuard allowedRoles={["admin"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="portal-header bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">CBT Exam Manager</h1>
          <p className="text-xs text-slate-500 mt-0.5">Create timed, auto-graded online exams for any class and subject.</p>
        </header>
        <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full overflow-y-auto">
          <ExamManager role="admin" />
        </div>
      </div>
    </AuthGuard>
  );
}
