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
      {
        error:
          "Admin user creation API is not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart the server.",
      },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json(
      { error: "Missing admin access token." },
      { status: 401 }
    );
  }

  const adminUser = await verifyAdminAccessToken(token);
  if (!adminUser) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "gracemark").trim() || "gracemark";
  if (!email) {
    return NextResponse.json(
      { error: "Email is required." },
      { status: 400 }
    );
  }

  const displayName = String(body.displayName || body.name || "").trim() || email.split("@")[0];
  const role = String(body.role || "student").trim().toLowerCase();
  // Students (new logins or admin-set passwords) must choose their own password
  const mustChange = body.mustChangePassword !== undefined ? Boolean(body.mustChangePassword) : role === "student";

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
      role,
    },
  });

  if (error) {
    const message = error.message || "Failed to create auth user.";
    if (/already|registered|exists/i.test(message)) {
      try {
        const { data: listData } = await service.auth.admin.listUsers();
        const existing = listData?.users?.find(
          (u) => u.email?.toLowerCase() === email.toLowerCase()
        );
        if (existing?.id) {
          // Update password to requested/default password
          await service.auth.admin.updateUserById(existing.id, {
            password,
            email_confirm: true,
          });

          // Ensure public.users row exists
          const { data: existingDbUser } = await service
            .from("users")
            .upsert(
              {
                auth_id: existing.id,
                email,
                display_name: displayName,
                role,
                status: "active",
                must_change_password: mustChange,
              },
              { onConflict: "auth_id" }
            )
            .select("id")
            .single();

          return NextResponse.json({
            user: { id: existing.id, dbUserId: existingDbUser?.id, email: existing.email ?? email },
            already_exists: true,
          });
        }
      } catch (listErr) {
        console.warn("Could not find existing user in auth:", listErr);
      }
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!data?.user?.id) {
    return NextResponse.json(
      { error: "Supabase did not return a new user id." },
      { status: 500 }
    );
  }

  // Ensure public.users row is always created
  const { data: dbUser } = await service
    .from("users")
    .upsert(
      {
        auth_id: data.user.id,
        email,
        display_name: displayName,
        role,
        status: "active",
        must_change_password: mustChange,
      },
      { onConflict: "auth_id" }
    )
    .select("id")
    .single();

  return NextResponse.json({
    user: { id: data.user.id, dbUserId: dbUser?.id, email: data.user.email ?? email },
  });
}
