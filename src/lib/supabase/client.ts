import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://kfdfplxidvgoffqrfipw.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmZGZwbHhpZHZnb2ZmcXJmaXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MzE4ODQsImV4cCI6MjA5NTIwNzg4NH0.c5gqs2uGpxOrIzyOZiQQ26_Aipk2n7KCSe1q5NtFlnM";

let browserClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseBrowserClient() {
  if (typeof window === "undefined") {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  if (!browserClient) {
    browserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return browserClient;
}

export const getSupabaseClient = getSupabaseBrowserClient;
export const supabase = getSupabaseBrowserClient();

/** Returns fetch headers carrying the current session's bearer token, for calling protected API routes. */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;

  // A cached token that is about to expire (or already has) is rejected by the API
  // as "Invalid or expired session", so renew it first.
  if (session?.expires_at && session.expires_at * 1000 - Date.now() < 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed.session ?? session;
  }

  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
