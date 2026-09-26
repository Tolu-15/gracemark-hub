import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/auth/check-device
 * Reads the HttpOnly "gm_device" cookie server-side.
 * Returns { trusted: true } if verified, { trusted: false } otherwise.
 */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get("gm_device");
  const isVerified = cookie?.value === "verified";
  return NextResponse.json({ trusted: isVerified });
}
