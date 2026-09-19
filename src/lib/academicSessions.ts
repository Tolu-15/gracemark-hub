import { supabase } from "./supabase/client";
import { getAppSettings, setAppSettings } from "./appSettings";

export interface AcademicSession {
  id: string;
  name: string;
  status: "active" | "inactive";
  is_current: boolean;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string;
}

/**
 * Fetch all academic sessions from Supabase.
 */
export async function getAcademicSessions(): Promise<AcademicSession[]> {
  try {
    const { data, error } = await supabase
      .from("academic_sessions")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.warn("Could not fetch academic_sessions:", error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn("Failed to fetch academic_sessions:", err);
    return [];
  }
}

/**
 * Create a new academic session.
 */
export async function createAcademicSession(
  name: string,
  setAsCurrent: boolean = false
): Promise<AcademicSession | null> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Session name is required.");

  if (setAsCurrent) {
    // Unmark any existing current session
    await supabase.from("academic_sessions").update({ is_current: false }).neq("name", trimmed);
  }

  const { data, error } = await supabase
    .from("academic_sessions")
    .insert([
      {
        name: trimmed,
        status: "active",
        is_current: setAsCurrent,
      },
    ])
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (setAsCurrent) {
    const settings = await getAppSettings();
    await setAppSettings({
      current_term: settings?.current_term || "term1",
      current_session: trimmed,
    });
  }

  return data;
}

/**
 * Delete a specific academic session by name or id.
 */
export async function deleteAcademicSession(identifier: string): Promise<boolean> {
  const settings = await getAppSettings();
  const currentSession = settings?.current_session || "";

  // Delete from academic_sessions
  const { error } = await supabase
    .from("academic_sessions")
    .delete()
    .or(`id.eq.${identifier},name.eq.${identifier}`);

  if (error) {
    throw new Error(error.message);
  }

  // If deleted session was the current session in app_settings, clear it
  if (currentSession === identifier) {
    await setAppSettings({
      current_term: settings?.current_term || "term1",
      current_session: "",
    });
  }

  return true;
}

/**
 * Delete all academic sessions and reset current_session in app_settings.
 */
export async function deleteAllAcademicSessions(): Promise<boolean> {
  const { error } = await supabase
    .from("academic_sessions")
    .delete()
    .neq("name", "__non_existent_key__");

  if (error) {
    throw new Error(error.message);
  }

  const settings = await getAppSettings();
  await setAppSettings({
    current_term: settings?.current_term || "term1",
    current_session: "",
  });

  return true;
}
