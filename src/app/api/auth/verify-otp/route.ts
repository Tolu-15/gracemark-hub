import { NextRequest, NextResponse } from "next/server";
import { verifyOtp } from "@/lib/otp";

/**
 * POST /api/auth/verify-otp
 * Body: { auth_id: string; otp: string }
 *
 * Validates the OTP. On success the client sets a long-lived device cookie
 * so subsequent logins from the same browser skip OTP.
 */
export async function POST(req: NextRequest) {
  try {
    const { auth_id, otp } = await req.json();

    if (!auth_id || !otp) {
      return NextResponse.json(
        { error: "auth_id and otp are required." },
        { status: 400 }
      );
    }

    const valid = await verifyOtp(auth_id, String(otp).trim());

    if (!valid) {
      return NextResponse.json(
        { error: "Invalid or expired verification code. Please try again." },
        { status: 401 }
      );
    }

    // Set a long-lived HttpOnly device cookie (30 days)
    const response = NextResponse.json({ ok: true });
    response.cookies.set("gm_device", "verified", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    return response;
  } catch (err: any) {
    console.error("[verify-otp] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to verify OTP." },
      { status: 500 }
    );
  }
}
