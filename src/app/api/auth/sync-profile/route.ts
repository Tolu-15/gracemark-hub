import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const service = getServiceClient();
  if (!service) return NextResponse.json({ error: "Profile service unavailable." }, { status: 503 });
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  const { data: profile, error: lookupError } = await service.from("users").select("*")
    .eq("auth_id", data.user.id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Profile lookup failed." }, { status: 503 });
  if (!profile) return NextResponse.json({ error: "Ask the school administrator to provision your profile." }, { status: 403 });
  return NextResponse.json({ ok: true, profile });
}
