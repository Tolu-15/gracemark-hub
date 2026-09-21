import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/client";

/**
 * PATCH /api/teacher/profile
 * Body: { personal_email?: string; phone?: string }
 *
 * Updates the authenticated teacher's profile fields.
 * Requires Authorization: Bearer <access_token> header.
 */
export async function PATCH(req: NextRequest) {
  try {
    // Extract bearer token from Authorization header
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    // Build a user-scoped client to verify the token
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    const userClient = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    // Verify they are a teacher using the service client
    const service = getServiceClient();
    if (!service) {
      return NextResponse.json({ error: "Service client not configured." }, { status: 503 });
    }

    const { data: profile } = await service
      .from("users")
      .select("role")
      .eq("auth_id", user.id)
      .maybeSingle();

    if (!profile || profile.role !== "teacher") {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const body = await req.json();
    const updates: Record<string, string> = {};

    if (typeof body.personal_email === "string") {
      updates.personal_email = body.personal_email.trim();
    }
    if (typeof body.phone === "string") {
      updates.phone = body.phone.trim();
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update." }, { status: 400 });
    }

    const { error: updateErr } = await service
      .from("users")
      .update(updates)
      .eq("auth_id", user.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: "Profile updated successfully." });
  } catch (err: any) {
    console.error("[teacher/profile] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to update profile." },
      { status: 500 }
    );
  }
}
