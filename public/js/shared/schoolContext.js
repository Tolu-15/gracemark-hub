import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings } from "/js/shared/appSettings.js";
import { fetchUserProfileByAuthId } from "/js/shared/auth.js";

let cachedDefaultSchool = null;
let cachedSettings = null;
let cachedCanManageSchool = null;

async function getSettings() {
  if (cachedSettings) return cachedSettings;
  cachedSettings = (await getAppSettings()) ?? { current_session: "" };
  return cachedSettings;
}

async function canManageSchoolData() {
  if (cachedCanManageSchool !== null) return cachedCanManageSchool;

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;

  const authId = data?.user?.id;
  if (!authId) {
    cachedCanManageSchool = false;
    return false;
  }

  const profile = await fetchUserProfileByAuthId(authId);
  cachedCanManageSchool = profile?.role === "admin";
  return cachedCanManageSchool;
}

export async function getDefaultSchool({ name = "Gracemark Academy" } = {}) {
  if (cachedDefaultSchool) return cachedDefaultSchool;

  const settings = await getSettings();
  const session = settings.current_session || "";

  const existing = await supabase
    .from("schools")
    .select("id, name, session")
    .eq("name", name)
    .eq("session", session)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) {
    throw new Error(
      "School setup is incomplete. Ask an administrator to open the admin dashboard and save session settings first."
    );
  }

  cachedDefaultSchool = existing.data;
  return cachedDefaultSchool;
}

export async function ensureDefaultSchool({ name = "Gracemark Academy" } = {}) {
  if (cachedDefaultSchool) return cachedDefaultSchool;

  const settings = await getSettings();
  const session = settings.current_session || "";

  const existing = await supabase
    .from("schools")
    .select("id, name, session")
    .eq("name", name)
    .eq("session", session)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    cachedDefaultSchool = existing.data;
    return cachedDefaultSchool;
  }

  if (!(await canManageSchoolData())) {
    throw new Error(
      "Only administrators can initialize school records. Open Admin → Dashboard and save the current session first."
    );
  }

  const created = await supabase.from("schools").insert({ name, session }).select("id, name, session").single();
  if (created.error) throw created.error;
  cachedDefaultSchool = created.data;
  return cachedDefaultSchool;
}

export async function ensureClassByName(className) {
  const name = String(className || "").trim();
  if (!name) throw new Error("Class name is required");

  const settings = await getSettings();
  const session = settings.current_session || "";
  const schoolResolver = (await canManageSchoolData()) ? ensureDefaultSchool : getDefaultSchool;
  const school = await schoolResolver();

  const existing = await supabase
    .from("classes")
    .select("id, school_id, name, session")
    .eq("school_id", school.id)
    .eq("name", name)
    .eq("session", session)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  if (!(await canManageSchoolData())) {
    throw new Error(`Class "${name}" was not found for the current session. Ask an administrator to add it.`);
  }

  const created = await supabase
    .from("classes")
    .insert({ school_id: school.id, name, session })
    .select("id, school_id, name, session")
    .single();
  if (created.error) throw created.error;
  return created.data;
}

export async function getClassByName(className) {
  const name = String(className || "").trim();
  if (!name) return null;

  const settings = await getSettings();
  const session = settings.current_session || "";
  const school = await getDefaultSchool();

  const { data, error } = await supabase
    .from("classes")
    .select("id, school_id, name, session")
    .eq("school_id", school.id)
    .eq("name", name)
    .eq("session", session)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function getClassesForDefaultSchool() {
  const settings = await getSettings();
  const session = settings.current_session || "";
  const school = await getDefaultSchool();

  const { data, error } = await supabase
    .from("classes")
    .select("id, name, session")
    .eq("school_id", school.id)
    .eq("session", session)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
