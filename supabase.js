import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
export { createClient };

export const SUPABASE_URL = "https://kfdfplxidvgoffqrfipw.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmZGZwbHhpZHZnb2ZmcXJmaXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MzE4ODQsImV4cCI6MjA5NTIwNzg4NH0.c5gqs2uGpxOrIzyOZiQQ26_Aipk2n7KCSe1q5NtFlnM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
