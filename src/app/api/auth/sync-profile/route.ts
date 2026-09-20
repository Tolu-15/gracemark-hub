import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    let authUser: any = null;
    if (token) {
      const { data: uData } = await service.auth.getUser(token);
      authUser = uData?.user || null;
    }

    if (!authUser) {
      const body = await req.json().catch(() => ({}));
      if (body.authId) {
        const { data: aUser } = await service.auth.admin.getUserById(body.authId);
        authUser = aUser?.user || null;
      }
    }

    if (!authUser) {
      return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    }

    // Check if public.users row exists
    const { data: existingUser } = await service
      .from("users")
      .select("*")
      .eq("auth_id", authUser.id)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json({ ok: true, profile: existingUser });
    }

    // Self-heal: Match with students or user_metadata
    const email = (authUser.email || "").toLowerCase();
    const admMatch = email.split("@")[0].replace(/[^a-z0-9]/g, "");

    const { data: stdList } = await service
      .from("students")
      .select("id, name, admission_no, user_id");

    const matchedStudent = (stdList || []).find((s: any) =>
      s.user_id === authUser.id ||
      (s.admission_no && s.admission_no.toLowerCase().replace(/[^a-z0-9]/g, "") === admMatch)
    );

    const displayName =
      matchedStudent?.name ||
      authUser.user_metadata?.display_name ||
      admMatch.toUpperCase();

    const role =
      authUser.user_metadata?.role ||
      (email.includes("teacher") ? "teacher" : "student");

    const { data: newUser, error: insErr } = await service
      .from("users")
      .upsert(
        {
          auth_id: authUser.id,
          email: authUser.email,
          display_name: displayName,
          role,
          status: "active",
        },
        { onConflict: "auth_id" }
      )
      .select("*")
      .single();

    if (insErr) throw insErr;

    if (matchedStudent) {
      await service.from("students").update({ user_id: authUser.id }).eq("id", matchedStudent.id);
    }

    return NextResponse.json({ ok: true, profile: newUser });
  } catch (err: any) {
    console.error("Sync profile error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
