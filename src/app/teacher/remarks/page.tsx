"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import EvaluationsEditor from "@/components/results/EvaluationsEditor";

export default function TeacherRemarksPage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[] | null>(null);
  const [term, setTerm] = useState("term1");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: profile }, settings] = await Promise.all([
        supabase.from("users").select("id").eq("auth_id", user.id).maybeSingle(),
        getAppSettings(),
      ]);
      if (settings?.current_term) setTerm(settings.current_term);

      // Personal remarks/skills are one-per-student-per-term, not per subject, so
      // only the class teacher fills them in — a subject teacher of the class has
      // no more claim to them than any other teacher.
      const ids = Array.from(new Set([user.id, (profile as any)?.id].filter(Boolean)));
      const { data: cta } = await supabase
        .from("class_teacher_assignments")
        .select("classes(id, name)")
        .in("teacher_user_id", ids)
        .eq("status", "active");
      const map = new Map<string, { id: string; name: string }>();
      (cta || []).forEach((a: any) => {
        if (a.classes?.id) map.set(a.classes.id, a.classes);
      });
      setClasses(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));
    })();
  }, []);

  if (!classes) return <div className="p-10 text-center text-sm text-slate-500">Loading…</div>;
  return <EvaluationsEditor classes={classes} initialTerm={term} isAdmin={false} />;
}
