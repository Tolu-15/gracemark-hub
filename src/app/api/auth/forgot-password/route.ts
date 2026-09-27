import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { createOtp } from "@/lib/otp";
import { sendPasswordResetOtpEmail } from "@/lib/email";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

/**
 * POST /api/auth/forgot-password
 * Body: { identifier: string; recovery_email?: string }
 *
 * Handles password recovery for Student, Teacher, and Admin:
 * - Student: Return message to contact admin (no reset allowed).
 * - Teacher: Must provide and verify registered recovery email before sending OTP.
 * - Admin: Sends OTP directly to registered admin email.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawIdentifier = String(body.identifier || "").trim();
    const recoveryEmail = typeof body.recovery_email === "string" ? body.recovery_email.trim() : "";

    if (!rawIdentifier) {
      return NextResponse.json(
        { ok: false, error: "Please enter your Email, Staff ID, or Admission Number." },
        { status: 400 }
      );
    }

    const service = getServiceClient();
    if (!service) {
      return NextResponse.json(
        { ok: false, error: "Database service unavailable. Please try again later." },
        { status: 503 }
      );
    }

    const cleanRef = rawIdentifier.replace(/^PAY-/i, "").replace(/\s+/g, "").toUpperCase();
    const hyphenated = cleanRef.includes("-") ? cleanRef : cleanRef.replace(/^(GMT)(\d+)/i, "$1-$2");
    const unhyphenated = cleanRef.replace(/-/g, "");

    // 1. Check if the identifier belongs to a student first
    try {
      const { data: student } = await service
        .from("students")
        .select("user_id, admission_no, users(email, role)")
        .or(`admission_no.ilike.${cleanRef},admission_no.ilike.${rawIdentifier}`)
        .limit(1)
        .maybeSingle();

      if (student) {
        return NextResponse.json({
          ok: true,
          role: "student",
          message: "Student accounts cannot reset passwords online. Please contact your school administrator or teacher to reset your password.",
        });
      }
    } catch (err) {
      console.warn("[forgot-password] Student lookup error:", err);
    }

    // 2. Search users table by email, staff_id, or personal_email
    const { data: user, error: userErr } = await service
      .from("users")
      .select("id, auth_id, email, personal_email, staff_id, role, display_name")
      .or(
        `email.ilike.${rawIdentifier},personal_email.ilike.${rawIdentifier},staff_id.ilike.${cleanRef},staff_id.ilike.${hyphenated},staff_id.ilike.${unhyphenated}`
      )
      .limit(1)
      .maybeSingle();

    if (userErr || !user) {
      return NextResponse.json(
        { ok: false, error: "No account found matching this identifier. Please verify and try again." },
        { status: 404 }
      );
    }

    const role = String(user.role || "").trim().toLowerCase();

    // Student role in users table
    if (role === "student") {
      return NextResponse.json({
        ok: true,
        role: "student",
        message: "Student accounts cannot reset passwords online. Please contact your school administrator or teacher to reset your password.",
      });
    }

    // Teacher role
    if (role === "teacher") {
      // Step 2a: Teacher hasn't entered recovery email yet
      if (!recoveryEmail) {
        return NextResponse.json({
          ok: true,
          role: "teacher",
          requires_recovery_email: true,
          staff_id: user.staff_id,
          name: user.display_name,
        });
      }

      // Step 2b: Teacher provided recovery email -> verify it matches records
      const registeredPersonal = (user.personal_email || "").trim().toLowerCase();
      const registeredPrimary = (user.email || "").trim().toLowerCase();
      const inputRecovery = recoveryEmail.toLowerCase();

      const matches =
        (registeredPersonal && registeredPersonal === inputRecovery) ||
        (registeredPrimary && registeredPrimary === inputRecovery);

      if (!matches) {
        return NextResponse.json(
          {
            ok: false,
            error: "The recovery email provided does not match our records for this teacher account. Please check and try again or contact your administrator.",
          },
          { status: 400 }
        );
      }

      // Validated! Generate and send OTP to the verified recovery email
      const otp = await createOtp(user.auth_id);
      await sendPasswordResetOtpEmail(
        recoveryEmail,
        otp,
        user.display_name || "Teacher"
      );

      return NextResponse.json({
        ok: true,
        role: "teacher",
        auth_id: user.auth_id,
        email_hint: maskEmail(recoveryEmail),
      });
    }

    // Admin role
    if (role === "admin") {
      if (!user.email) {
        return NextResponse.json(
          { ok: false, error: "Admin account has no email address configured in records." },
          { status: 400 }
        );
      }

      const otp = await createOtp(user.auth_id);
      await sendPasswordResetOtpEmail(
        user.email,
        otp,
        user.display_name || "Administrator"
      );

      return NextResponse.json({
        ok: true,
        role: "admin",
        auth_id: user.auth_id,
        email_hint: maskEmail(user.email),
      });
    }

    // Any other roles (e.g. parent, staff)
    return NextResponse.json({
      ok: true,
      role,
      message: "Please contact the school administrator to request a password reset for this account.",
    });
  } catch (err: any) {
    console.error("[forgot-password] Error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to process forgot password request." },
      { status: 500 }
    );
  }
}
