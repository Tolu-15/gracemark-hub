import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

let serviceClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return null;
  }

  if (!serviceClient) {
    serviceClient = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        transport: ws,
      },
    });
  }

  return serviceClient;
}
