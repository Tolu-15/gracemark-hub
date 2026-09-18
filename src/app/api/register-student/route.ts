import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json(
      { error: "Service role not configured. Set SUPABASE_SERVICE_ROLE_KEY in .env" },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.display_name || "").trim();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, role: "student" },
  });

  if (error) {
    const message = error.message || "Failed to create auth user.";
    if (/already|registered|exists/i.test(message)) {
      try {
        const { data: listData } = await service.auth.admin.listUsers({ perPage: 1000 });
        const existing = (listData?.users || []).find((u) => u.email === email);
        if (existing) {
          return NextResponse.json({
            user: { id: existing.id, email: existing.email },
            already_exists: true,
          });
        }
      } catch (_) {}
      return NextResponse.json(
        { error: "Account already registered. Please login instead." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!data?.user?.id) {
    return NextResponse.json({ error: "Supabase did not return a user id." }, { status: 500 });
  }

  return NextResponse.json({
    user: { id: data.user.id, email: data.user.email ?? email },
  });
}
