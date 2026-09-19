import { supabase } from "./supabase/client";

export interface AppSettings {
  id?: number;
  current_term?: string;
  current_session?: string;
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
  return data;
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
      }
    } catch (apiErr) {
      console.warn("API /api/admin/settings update failed, trying direct client:", apiErr);
    }
  }

  const { data: existing } = await supabase
    .from("app_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  const id = existing?.id || 1;
  const payload = { id, current_term, current_session: current_session ?? "" };

  const { data, error } = await supabase
    .from("app_settings")
    .upsert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

