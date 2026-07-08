import { supabase } from "./supabaseClient.js";

// 1. Sign in with Email and Password
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data; // returns { user, session }
}

// 1b. Sign up new user and insert profile into database
export async function signUpUser(email, password, displayName, role) {
  // 1. Create the user in Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });
  if (authError) throw authError;
  if (!authData?.user) throw new Error("Signup failed: No user returned.");

  // 2. Insert the linked profile into the public.users table
  const { error: dbError } = await supabase.from("users").insert([{
    auth_id: authData.user.id,
    email: authData.user.email,
    display_name: displayName,
    role: role
  }]);
  if (dbError) throw dbError;

  return authData;
}

// 2. Get current logged-in user profile (Clean auth helper function)
export async function getCurrentUserProfile() {
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data?.user) return null;

  return await fetchUserProfileByAuthId(data.user.id);
}

// 3. Fetch profile using auth_id (CRITICAL FIX: DO NOT USE .eq("id", user.id))
export async function fetchUserProfileByAuthId(authId) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("auth_id", authId)
    .maybeSingle(); // Fix: Returns null instead of crashing if no profile exists

  if (error) {
    console.error("Error fetching user profile by auth_id:", error);
    throw error;
  }
  return data;
}

// 4. Role-based redirect logic
export function destinationForRole(role) {
  switch (role) {
    case "admin": return "/admin/dashboard/";
    case "teacher": return "/teacher/dashboard/";
    case "student": return "/student/dashboard/";
    default: return "/";
  }
}

// 5. Get current active session
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("Error fetching session:", error);
    return null;
  }
  return data.session;
}

// 6. Sign out user
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Error during sign out:", error);
    throw error;
  }
}