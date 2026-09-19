import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { user_id, new_password } = body;

    if (!user_id || !new_password) {
      return NextResponse.json(
        { error: "User ID and new password are required." },
        { status: 400 }
      );
    }

    if (new_password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const service = getServiceClient();
    if (!service) {
      return NextResponse.json(
        { error: "Supabase service client not configured." },
        { status: 503 }
      );
    }

    // 1. Update Supabase Auth User password
    const { error: authErr } = await service.auth.admin.updateUserById(user_id, {
      password: new_password,
    });

    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    // 2. Clear must_change_password on users table
    try {
      await service
        .from("users")
        .update({ must_change_password: false })
        .eq("auth_id", user_id);
    } catch {
      // column or table error fallback
    }

    // 3. Clear must_change_password on students table if student
    try {
      await service
        .from("students")
        .update({ must_change_password: false })
        .or(`user_id.eq.${user_id},id.eq.${user_id}`);
    } catch {
      // fallback
    }

    return NextResponse.json({
      ok: true,
      message: "Password updated successfully.",
    });
  } catch (err: any) {
    console.error("Change password route error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to update password." },
      { status: 500 }
    );
  }
}
