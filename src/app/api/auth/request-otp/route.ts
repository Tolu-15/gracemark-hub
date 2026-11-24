import { NextRequest, NextResponse } from "next/server";
import { challengeActor } from "@/lib/adminChallenge";
import { generateOtp, otpDigest } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  const auth = await challengeActor(req);
  if ("response" in auth) return auth.response;
  const { actor, sessionId } = auth;
  if (!actor.email) return NextResponse.json({ error: "The admin account needs a verified email." }, { status: 400 });
  const otp = generateOtp();
  const { data, error } = await actor.service.rpc("issue_admin_challenge", {
    p_user: actor.authId, p_session: sessionId, p_digest: otpDigest(actor.authId, sessionId, otp)
  });
  if (error) return NextResponse.json({ error: "Verification is temporarily unavailable." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Please wait before requesting another code." }, { status: 429 });
  try {
    await sendOtpEmail(actor.email, otp, "Administrator");
    return NextResponse.json({ ok: true, email_hint: actor.email.replace(/^(.).+?@/, "$1***@") });
  } catch {
    return NextResponse.json({ error: "Email delivery failed. Request a new code in a minute." }, { status: 503 });
  }
}
