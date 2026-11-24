import { NextRequest, NextResponse } from "next/server";
import { challengeActor } from "@/lib/adminChallenge";
import { TRUST_COOKIE, trustsDevice } from "@/lib/otp";

export async function GET(req: NextRequest) {
  const auth = await challengeActor(req);
  if ("response" in auth) return auth.response;
  const cookie = req.cookies.get(TRUST_COOKIE)?.value;
  const trusted = trustsDevice(cookie, auth.actor.authId);
  if (trusted) {
    const { error } = await auth.actor.service.from("verified_admin_sessions").upsert({
      session_id: auth.sessionId, auth_id: auth.actor.authId, expires_at: new Date(Number(cookie!.split(".")[0]) * 1000).toISOString()
    });
    if (error) return NextResponse.json({ error: "Could not verify session." }, { status: 503 });
  }
  return NextResponse.json({ trusted }, { headers: { "Cache-Control": "private, no-store" } });
}
