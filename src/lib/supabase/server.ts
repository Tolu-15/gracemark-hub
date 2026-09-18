import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./client";

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let serviceClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient | null {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (!serviceClient) {
    serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return serviceClient;
}
