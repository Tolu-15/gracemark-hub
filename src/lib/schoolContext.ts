import { supabase } from "./supabase/client";
import { getAppSettings } from "./appSettings";

let cachedDefaultSchool: { id: string; name: string; session?: string } | null = null;

export async function getDefaultSchool({ name = "Gracemark Academy" } = {}) {
  if (cachedDefaultSchool) return cachedDefaultSchool;

  let { data, error } = await supabase
    .from("schools")
    .select("id, name, session")
    .eq("name", name)
    .limit(1)
    .maybeSingle();

  if (!data) {
    const { data: anySchool } = await supabase
      .from("schools")
      .select("id, name, session")
      .limit(1)
      .maybeSingle();
    data = anySchool;
  }

  if (!data) {
    // If no school exists at all, auto create one with default session
    const settings = await getAppSettings();
    const session = settings?.current_session || "";
    const { data: created, error: insErr } = await supabase
      .from("schools")
      .insert({ name, session })
      .select("id, name, session")
      .single();
    if (insErr) {
      throw new Error(
        "School setup is incomplete. Please ensure a school record exists."
      );
    }
    cachedDefaultSchool = created;
    return cachedDefaultSchool;
  }

  cachedDefaultSchool = data;
  return cachedDefaultSchool;
}

export async function ensureClassByName(className: string) {
  const name = String(className || "").trim();
  if (!name) throw new Error("Class name is required");

  const settings = await getAppSettings();
  const session = settings?.current_session || "";

  const { data: existing, error } = await supabase
    .from("classes")
    .select("id, school_id, name, session")
    .eq("name", name)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (existing) return existing;

  const school = await getDefaultSchool();
  const { data: created, error: createError } = await supabase
    .from("classes")
    .insert({ school_id: school.id, name, session })
    .select("id, school_id, name, session")
    .single();

  if (createError) throw createError;
  return created;
}

export async function getClassByName(className: string) {
  const name = String(className || "").trim();
  if (!name) return null;

  const { data, error } = await supabase
    .from("classes")
    .select("id, school_id, name, session")
    .eq("name", name)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function getClassesForDefaultSchool() {
  const { data, error } = await supabase
    .from("classes")
    .select("id, name, session")
    .order("name", { ascending: true });

  if (error) throw error;
  return data ?? [];
}
