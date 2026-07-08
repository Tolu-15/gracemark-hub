import { supabase } from "/js/shared/supabaseClient.js";

export async function getAppSettings() {
  const latest = await getLatestAppSettings();
  if (latest) return latest;

  const { data, error } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Most recently saved row in app_settings (by updated_at). */
export async function getLatestAppSettings() {
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}
