import { supabase } from "./supabase/client";

export interface AppSettings {
  id?: number;
  current_term?: string;
  current_session?: string;
  current_session_id?: string;
  active_term?: string;
  active_session?: string;
  resumption_date?: string;
  updated_at?: string;
}

export async function getAppSettings(): Promise<AppSettings | null> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/admin/settings");
      if (res.ok) {
        const json = await res.json();
        if (json.ok && json.settings) {
          return json.settings;
        }
      }
    } catch (apiErr) {
      console.warn("Could not fetch /api/admin/settings, falling back to direct client:", apiErr);
    }
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error fetching app settings:", error);
    return null;
  }

  let sessionName = data?.current_session || "";
  if (!sessionName && data?.current_session_id) {
    const { data: sess } = await supabase
      .from("academic_sessions")
      .select("name")
      .eq("id", data.current_session_id)
      .maybeSingle();
    if (sess?.name) sessionName = sess.name;
  }

  return {
    ...data,
    current_session: sessionName,
  };
}

export async function setAppSettings({
  current_term,
  current_session,
}: {
  current_term: string;
  current_session: string;
}): Promise<AppSettings> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_term, current_session }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.ok && json.settings) {
          return json.settings;
        }
        if (!json.ok && json.error) {
          throw new Error(json.error);
        }
      }
    } catch (apiErr: any) {
      console.warn("API /api/admin/settings update failed, trying direct client:", apiErr);
      if (apiErr.message && !apiErr.message.includes("fetch")) {
        throw apiErr;
      }
    }
  }

  const { data: existing } = await supabase
    .from("app_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  const id = existing?.id || 1;

  let current_session_id: string | null = null;
  if (current_session) {
    const { data: sessRow } = await supabase
      .from("academic_sessions")
      .select("id")
      .eq("name", current_session)
      .maybeSingle();
    if (sessRow?.id) current_session_id = sessRow.id;
  }

  const payload: any = {
    id,
    current_term,
    updated_at: new Date().toISOString(),
  };
  if (current_session_id) {
    payload.current_session_id = current_session_id;
  }

  const { data, error } = await supabase
    .from("app_settings")
    .upsert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return { ...data, current_session };
}
