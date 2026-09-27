"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import EvaluationsEditor from "@/components/results/EvaluationsEditor";

export default function AdminRemarksPage() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [term, setTerm] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data }, settings] = await Promise.all([
        supabase.from("classes").select("id, name").order("display_order"),
        getAppSettings(),
      ]);
      setClasses(data || []);
      setTerm(settings?.current_term || "term1");
    })();
  }, []);

  if (!term) return <div className="p-10 text-center text-sm text-slate-500">Loading…</div>;
  return <EvaluationsEditor classes={classes} initialTerm={term} isAdmin />;
}
