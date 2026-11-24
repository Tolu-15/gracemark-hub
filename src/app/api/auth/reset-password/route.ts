import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getServiceClient } from "@/lib/supabase/server";
import { otpDigest } from "@/lib/otp";
import { sendPasswordChangedEmail } from "@/lib/email";

const digest = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * POST /api/auth/reset-password
 *
 * Action 1: { action: "verify", auth_id: string, otp: string }
 *   Validates the OTP and returns a single-use 15-minute reset token.
 *
 * Action 2: { action: "reset", auth_id: string, reset_token: string, new_password: string }
 *   Validates the token, updates the user's password, and clears must_change_password.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action, auth_id, otp, reset_token, new_password } = body;

    if (!auth_id) {
      return NextResponse.json(
        { ok: false, error: "Missing required user reference." },
        { status: 400 }
      );
    }

    const service = getServiceClient();
    if (!service) {
      return NextResponse.json(
        { ok: false, error: "Database service unavailable." },
        { status: 503 }
      );
    }

    // --- Action 1: Verify OTP ---
    if (action === "verify") {
      if (!otp || String(otp).trim().length < 6) {
        return NextResponse.json(
          { ok: false, error: "Please provide all 6 digits of the verification code." },
          { status: 400 }
        );
      }

      const token = crypto.randomBytes(32).toString("hex");
      const { data: isValid, error } = await service.rpc("exchange_reset_code", {
        p_user: auth_id, p_token: digest(token), p_code: otpDigest(auth_id, "password-reset", String(otp).trim()),
      });
      if (error) return NextResponse.json({ ok: false, error: "Password recovery unavailable." }, { status: 503 });
      if (!isValid) {
        return NextResponse.json(
          { ok: false, error: "Invalid or expired verification code. Please check or request a new one." },
          { status: 401 }
        );
      }

      return NextResponse.json({
        ok: true,
        reset_token: token,
      });
    }

    // --- Action 2: Reset Password ---
    if (action === "reset") {
      if (!reset_token) {
        return NextResponse.json(
          { ok: false, error: "Missing reset authorization token. Please verify your OTP again." },
          { status: 400 }
        );
      }

      if (!new_password || String(new_password).length < 6) {
        return NextResponse.json(
          { ok: false, error: "Password must be at least 6 characters long." },
          { status: 400 }
        );
      }

      const { data: isTokenValid, error } = await service.rpc("claim_reset_token", { p_user: auth_id, p_token: digest(String(reset_token)) });
      if (error) return NextResponse.json({ ok: false, error: "Password recovery unavailable." }, { status: 503 });
      if (!isTokenValid) {
        return NextResponse.json(
          { ok: false, error: "Reset session has expired or is invalid. Please start the recovery process again." },
          { status: 401 }
        );
      }

      // 1. Update Supabase Auth user password
      const { error: authErr } = await service.auth.admin.updateUserById(auth_id, {
        password: String(new_password),
      });

      if (authErr) {
        return NextResponse.json(
          { ok: false, error: authErr.message || "Failed to update auth password." },
          { status: 400 }
        );
      }

      // 2. Clear must_change_password on users table
      try {
        await service
          .from("users")
          .update({ must_change_password: false })
          .eq("auth_id", auth_id);
      } catch (err) {
        console.warn("[reset-password] could not clear must_change_password:", err);
      }

      // 3. Send email confirmation if user has email
      try {
        const { data: userProfile } = await service
          .from("users")
          .select("email, personal_email, display_name, role")
          .eq("auth_id", auth_id)
          .maybeSingle();

        const targetEmail = userProfile?.personal_email || userProfile?.email;
        if (targetEmail) {
          await sendPasswordChangedEmail(
            targetEmail,
            userProfile.display_name || "User",
            userProfile.role || "teacher"
          );
        }
      } catch (emailErr) {
        console.warn("[reset-password] Confirmation email error:", emailErr);
      }

      return NextResponse.json({
        ok: true,
        message: "Your password has been successfully reset.",
      });
    }

    return NextResponse.json(
      { ok: false, error: "Invalid action specified." },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("[reset-password] Error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to reset password." },
      { status: 500 }
    );
  }
}
