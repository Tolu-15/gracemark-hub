import { NextRequest, NextResponse } from "next/server";
import { challengeActor } from "@/lib/adminChallenge";
import { issueDevice, otpDigest, TRUST_COOKIE, TRUST_SECONDS } from "@/lib/otp";

export async function POST(req: NextRequest) {
  const auth = await challengeActor(req);
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null);
  if (typeof body?.otp !== "string" || !/^\d{6}$/.test(body.otp)) return NextResponse.json({ error: "Enter the six-digit code." }, { status: 400 });
  const { actor, sessionId } = auth;
  const { data, error } = await actor.service.rpc("consume_admin_challenge", {
    p_user: actor.authId, p_session: sessionId, p_digest: otpDigest(actor.authId, sessionId, body.otp)
  });
  if (error) return NextResponse.json({ error: "Verification unavailable." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Invalid, expired or already used code." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(TRUST_COOKIE, issueDevice(actor.authId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: TRUST_SECONDS, path: "/" });
  return response;
}
