import { SUPABASE_ANON_KEY, SUPABASE_URL, createClient } from "/supabase.js";

export function createSecondarySupabaseClient(storageKey) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // Prevent the secondary client from overwriting the primary user's session.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey,
    },
  });
}
