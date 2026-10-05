import { supabase, getAuthHeaders } from "./supabase/client";
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
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/admin/sessions", { headers: await getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        if (json.ok && Array.isArray(json.sessions) && json.sessions.length > 0) {
          return json.sessions;
        }
      }
    } catch (apiErr) {
      console.warn("Could not fetch /api/admin/sessions, falling back to direct client:", apiErr);
    }
  }

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
  // The identifier may be the session id or its name (e.g. "2025/2026"). The
  // API route resolves it by name, so look up the name first if an id was passed.
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  let name = identifier;
  if (isId) {
    const { data } = await supabase.from("academic_sessions").select("name").eq("id", identifier).maybeSingle();
    name = data?.name || identifier;
  }

  const res = await fetch("/api/admin/sessions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({ name }),
  });
  const json = await res.json().catch(() => ({ ok: false, error: "Unexpected server response" }));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "Failed to delete session");
  }

  return true;
}

/**
 * Delete all academic sessions and reset current_session in app_settings.
 */
export async function deleteAllAcademicSessions(): Promise<boolean> {
  const res = await fetch("/api/admin/sessions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({ all: true }),
  });
  const json = await res.json().catch(() => ({ ok: false, error: "Unexpected server response" }));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "Failed to delete all sessions");
  }

  return true;
}
