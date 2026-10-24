import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getMaintenance } from "@/lib/systemSettings";

/**
 * GET — whether the portal is in maintenance mode. Public so the login page and portal guard can
 * ask before anyone is signed in. If a valid access token is sent, `bypass` says whether this user
 * may still use the app (the developer, or an admin when the developer allowed it).
 */
export async function GET(req: NextRequest) {
  const service = getServiceClient();
  const headers = { "Cache-Control": "no-store" };
  if (!service) return NextResponse.json({ enabled: false, bypass: false }, { headers });

  const m = await getMaintenance(service);
  if (!m.enabled) return NextResponse.json({ enabled: false, bypass: false }, { headers });

  let bypass = false;
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token) {
    const { data: userData } = await service.auth.getUser(token);
    if (userData?.user?.id) {
      const { data: profile } = await service.from("users").select("role, is_developer").eq("auth_id", userData.user.id).maybeSingle();
      bypass = Boolean(profile?.is_developer) || (m.allowAdmins && profile?.role === "admin");
    }
  }

  return NextResponse.json({ enabled: true, message: m.message, backAt: m.backAt, bypass }, { headers });
}
