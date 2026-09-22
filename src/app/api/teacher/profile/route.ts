import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

/**
 * PATCH /api/teacher/profile
 * Body: { personal_email?: string; phone?: string }
 *
 * Updates the authenticated teacher's profile fields.
 * Requires Authorization: Bearer <access_token> header.
 */
export async function PATCH(req: NextRequest) {
  try {
    const authorization = await requireApiActor(req, ["teacher"]);
    if ("response" in authorization) {
      return authorization.response;
    }
    const { actor } = authorization;

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

    const { error: updateErr } = await actor.service
      .from("users")
      .update(updates)
      .eq("auth_id", actor.authId);

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
