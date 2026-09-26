import { supabase } from "./supabase/client";
import { UserProfile, UserRole } from "@/types/database";

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUpUser(
  email: string,
  password: string,
  displayName: string,
  role: UserRole
) {
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });
  if (authError) throw authError;
  if (!authData?.user) throw new Error("Signup failed: No user returned.");

  const { error: dbError } = await supabase.from("users").insert([
    {
      auth_id: authData.user.id,
      email: authData.user.email,
      display_name: displayName,
      role: role,
    },
  ]);
  if (dbError) throw dbError;

  return authData;
}

export async function fetchUserProfileByAuthId(authId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("auth_id", authId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching user profile by auth_id:", error);
    throw error;
  }
  return data as UserProfile | null;
}

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data?.user) return null;

  return await fetchUserProfileByAuthId(data.user.id);
}

/**
 * students.user_id has historically been populated with either the Supabase Auth
 * user id or the public.users.id row id, depending on which code path created the
 * account. Returns every id a student's row might be linked under, so lookups can
 * match regardless of which convention was used.
 */
export async function resolveStudentUserIdCandidates(authUserId: string): Promise<string[]> {
  const candidates = [authUserId];
  const { data: profile } = await supabase
    .from("users")
    .select("id")
    .eq("auth_id", authUserId)
    .maybeSingle();
  if (profile?.id && profile.id !== authUserId) {
    candidates.push(profile.id);
  }
  return candidates;
}

export function destinationForRole(role?: string | null): string {
  switch (role) {
    case "admin":
      return "/admin/dashboard";
    case "teacher":
      return "/teacher/dashboard";
    case "student":
      return "/student/dashboard";
    default:
      return "/";
  }
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("Error fetching session:", error);
    return null;
  }
  return data.session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Error during sign out:", error);
    throw error;
  }
}

export async function resolveUserLoginEmail(rawId: string): Promise<string> {
  const trimmed = String(rawId || "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed.toLowerCase();

  const cleanRef = trimmed.replace(/^PAY-/i, "").replace(/\s+/g, "").toUpperCase();
  const clean = cleanRef.replace(/[^A-Z0-9]/gi, "").toLowerCase();

  // 1. Try server API resolution (service role bypasses RLS safely)
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/auth/resolve-identifier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: trimmed }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.ok && json.email) {
          return json.email.toLowerCase();
        }
      }
    } catch {
      // offline/fallback to client resolution
    }
  }

  // 2. Direct client query (if session or public read is permitted)
  try {
    const hyphenated = cleanRef.includes("-") ? cleanRef : cleanRef.replace(/^(GMT)(\d+)/i, "$1-$2");
    const unhyphenated = cleanRef.replace(/-/g, "");

    const { data: staffUser } = await supabase
      .from("users")
      .select("email, staff_id")
      .or(`staff_id.ilike.${cleanRef},staff_id.ilike.${hyphenated},staff_id.ilike.${unhyphenated}`)
      .limit(1)
      .maybeSingle();

    if (staffUser?.email) {
      return staffUser.email.toLowerCase();
    }
  } catch {
    /* RLS unauthenticated fallback */
  }

  // 3. Check students table by admission_no
  try {
    const { data: student } = await supabase
      .from("students")
      .select("user_id, admission_no, users(email)")
      .ilike("admission_no", cleanRef)
      .limit(1)
      .maybeSingle();

    const studentAny = student as any;
    if (studentAny?.users?.email) {
      return studentAny.users.email.toLowerCase();
    }
  } catch {
    /* RLS unauthenticated fallback */
  }

  // 4. Check admissions table by admission_number
  try {
    const { data: adm } = await supabase
      .from("admissions")
      .select("parent_guardian_email, admission_number")
      .ilike("admission_number", cleanRef)
      .limit(1)
      .maybeSingle();

    if (adm?.parent_guardian_email) {
      return adm.parent_guardian_email.toLowerCase();
    }
  } catch {
    /* RLS unauthenticated fallback */
  }

  // 5. Fallback synthetic email format
  const isTeacherPattern =
    /^(GMT|GMAT|GMA-T|GM-T|TEA|STAFF|T\d+|T-)/i.test(cleanRef) ||
    /^(gmt|gmat|tea|staff|t\d+)/i.test(clean);

  if (isTeacherPattern) {
    return `${clean}@teacher.gracemark.edu.ng`;
  }
  return `${clean}@student.gracemark.edu.ng`;
}

export function friendlyAuthError(error: any): string {
  const message = String(error?.message || "");
  const code = String(error?.code || "");

  if (/email not confirmed/i.test(message)) {
    return "Email not confirmed. Please confirm your email in Supabase Auth or contact administrator.";
  }
  if (/invalid login credentials|invalid_credentials/i.test(message + code)) {
    return "Invalid email/admission number or password. Please verify your credentials.";
  }
  if (/invalid api key|jwt/i.test(message)) {
    return "Authentication configuration issue. Please contact support.";
  }
  if (/relation.*users.*does not exist|Could not find the table.*users/i.test(message)) {
    return "Database table not found. Please verify schema setup.";
  }
  if (/failed to fetch|network/i.test(message)) {
    return "Network error: Cannot reach Supabase server. Please check your internet connection.";
  }

  const map: Record<string, string> = {
    "auth/invalid-credentials": "Invalid email or password. Please try again.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many failed attempts. Please wait a moment and try again.",
  };
  return map[code] ?? (message || "Something went wrong. Please try again.");
}
