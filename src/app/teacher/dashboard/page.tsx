"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

export default function TeacherDashboardPage() {
  const [teacherName, setTeacherName] = useState("Teacher");
  const [assignedClasses, setAssignedClasses] = useState<{ id: string; name: string }[]>([]);
  const [assignedSubjects, setAssignedSubjects] = useState<{ id: string; name: string }[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadTeacherData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) return;

      // Fetch profile
      const { data: profile } = await supabase
        .from("users")
        .select("id, display_name, role")
        .eq("auth_id", user.id)
        .maybeSingle();

      if (profile?.display_name) {
        setTeacherName(profile.display_name);
      }

      const teacherUid = profile?.id || user.id;
      const idList = Array.from(new Set([user.id, teacherUid].filter(Boolean)));

      // 1. Fetch Class & Subject Teacher duties
      const [ctaRes, staRes, ctClassesRes] = await Promise.all([
        supabase
          .from("class_teacher_assignments")
          .select("class_id, classes(id, name)")
          .in("teacher_user_id", idList)
          .eq("status", "active"),
        supabase
          .from("subject_teacher_assignments")
          .select("class_id, subject_id, classes(id, name), subjects(id, name)")
          .in("teacher_user_id", idList)
          .eq("status", "active"),
        supabase
          .from("classes")
          .select("id, name")
          .in("class_teacher_id", idList),
      ]);

      const classMap = new Map<string, { id: string; name: string }>();
      const subjectMap = new Map<string, { id: string; name: string }>();
      const classTeacherClassList: { id: string; name: string }[] = [];

      // Add Class Teacher assignments
      (ctaRes.data || []).forEach((c: any) => {
        if (c.classes?.name) {
          classMap.set(c.classes.id, c.classes);
          classTeacherClassList.push(c.classes);
        }
      });
      (ctClassesRes.data || []).forEach((c: any) => {
        if (c.name) {
          classMap.set(c.id, c);
          if (!classTeacherClassList.some((x) => x.id === c.id)) {
            classTeacherClassList.push(c);
          }
        }
      });

      // Add Subject Teacher assignments
      (staRes.data || []).forEach((a: any) => {
        if (a.classes?.name) classMap.set(a.classes.id, a.classes);
        if (a.subjects?.name) subjectMap.set(a.subjects.id, a.subjects);
      });

      const uniqueClasses = Array.from(classMap.values());
      const uniqueSubjects = Array.from(subjectMap.values());

      setAssignedClasses(uniqueClasses);
      setAssignedSubjects(uniqueSubjects);

      // Student count across assigned classes
      if (uniqueClasses.length > 0) {
        const cIds = uniqueClasses.map((c) => c.id);
        const { count } = await supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .in("class_id", cIds);
        setStudentCount(count || 0);
      }
    } catch (err) {
      console.error("Teacher dashboard load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeacherData();
  }, [loadTeacherData]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Welcome Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs">
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200 mb-2">
          Educator Workspace
        </span>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Welcome back, {teacherName}
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Enter weekly scores, track daily AM/PM class attendance, and manage continuous assessment reports.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Assigned Classes
          </span>
          <div>
            <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {loading ? "—" : assignedClasses.length}
            </span>
            <span className="text-xs text-slate-400 block mt-0.5">Class cohorts under your care</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Total Enrolled Students
          </span>
          <div>
            <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {loading ? "—" : studentCount}
            </span>
            <span className="text-xs text-slate-400 block mt-0.5">Students in your assigned classes</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Teaching Subjects
          </span>
          <div>
            <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {loading ? "—" : assignedSubjects.length}
            </span>
            <span className="text-xs text-slate-400 block mt-0.5">Authorized curriculum subjects</span>
          </div>
        </div>
      </div>

      {/* Quick Action Navigation Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          href="/teacher/score-entry"
          className="p-5 bg-white border border-slate-200/80 hover:border-[#c9a84c] rounded-2xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <span className="font-bold text-slate-900 text-sm block mb-1">
              Master Mark Sheet
            </span>
            <p className="text-xs text-slate-500 leading-relaxed">
              Enter classwork, homework, regular tests, projects, and term exam scores.
            </p>
          </div>
        </Link>

        <Link
          href="/teacher/attendance"
          className="p-5 bg-white border border-slate-200/80 hover:border-[#c9a84c] rounded-2xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <span className="font-bold text-slate-900 text-sm block mb-1">
              Daily Attendance
            </span>
            <p className="text-xs text-slate-500 leading-relaxed">
              Log Morning (AM) and Afternoon (PM) student attendance per class.
            </p>
          </div>
        </Link>

        <Link
          href="/teacher/remarks"
          className="p-5 bg-white border border-slate-200/80 hover:border-[#c9a84c] rounded-2xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
        >
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          </div>
          <div>
            <span className="font-bold text-slate-900 text-sm block mb-1">
              Trait Remarks & Evaluation
            </span>
            <p className="text-xs text-slate-500 leading-relaxed">
              Rate punctuality, neatness, cooperation, and submit term remarks.
            </p>
          </div>
        </Link>

        <Link
          href="/teacher/gradebook"
          className="p-5 bg-white border border-slate-200/80 hover:border-[#c9a84c] rounded-2xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <span className="font-bold text-slate-900 text-sm block mb-1">
              Class Gradebook
            </span>
            <p className="text-xs text-slate-500 leading-relaxed">
              Overview of student scores, grade distributions, and class averages.
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
