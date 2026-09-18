import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

async function verifyAdminAccessToken(accessToken: string) {
  const service = getServiceClient();
  if (!service) return null;

  const { data: userData, error: userError } = await service.auth.getUser(accessToken);
  if (userError || !userData?.user?.id) return null;

  const { data: profile, error: profileError } = await service
    .from("users")
    .select("role")
    .eq("auth_id", userData.user.id)
    .maybeSingle();
  if (profileError || profile?.role !== "admin") return null;

  return userData.user;
}

export async function POST(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json(
      { error: "Admin user creation API is not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env." },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing admin access token." }, { status: 401 });
  }

  const adminUser = await verifyAdminAccessToken(token);
  if (!adminUser) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    const message = error.message || "Failed to create auth user.";
    const status = /already|registered|exists/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  if (!data?.user?.id) {
    return NextResponse.json({ error: "Supabase did not return a new user id." }, { status: 500 });
  }

  return NextResponse.json({
    user: { id: data.user.id, email: data.user.email ?? email },
  });
}
