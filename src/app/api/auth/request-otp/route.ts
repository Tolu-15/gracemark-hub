import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { createOtp } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/email";

/**
 * POST /api/auth/request-otp
 * Body: { auth_id: string }
 *
 * Generates a new OTP, saves it, and emails it to the admin.
 * Called immediately after a successful admin login when no device cookie is present.
 */
export async function POST(req: NextRequest) {
  try {
    const { auth_id } = await req.json();

    if (!auth_id) {
      return NextResponse.json({ error: "auth_id is required." }, { status: 400 });
    }

    const service = getServiceClient();
    if (!service) {
      return NextResponse.json(
        { error: "Service client not configured." },
        { status: 503 }
      );
    }

    // Fetch the admin's email and display name
    const { data: profile, error: profileErr } = await service
      .from("users")
      .select("email, display_name, role")
      .eq("auth_id", auth_id)
      .eq("role", "admin")
      .maybeSingle();

    if (profileErr || !profile) {
      return NextResponse.json(
        { error: "Admin profile not found." },
        { status: 404 }
      );
    }

    if (!profile.email) {
      return NextResponse.json(
        { error: "Admin account has no email address configured." },
        { status: 400 }
      );
    }

    // Generate and store OTP
    const otp = await createOtp(auth_id);

    // Send via Brevo
    await sendOtpEmail(profile.email, otp, profile.display_name || "Administrator");

    return NextResponse.json({
      ok: true,
      message: `Verification code sent to ${profile.email}`,
      email_hint: maskEmail(profile.email),
    });
  } catch (err: any) {
    console.error("[request-otp] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to send OTP." },
      { status: 500 }
    );
  }
}

/** Returns a masked version of the email for display e.g. ad***@gmail.com */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}
