import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "./apiAuth";
import { verifiedSessionId } from "./otp";

export async function challengeActor(req: NextRequest) {
  const result = await requireApiActor(req, ["admin"], { adminChallenge: true });
  if ("response" in result) return result;
  const sessionId = verifiedSessionId((req.headers.get("authorization") || "").slice(7));
  if (!sessionId) return { response: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) };
  return { actor: result.actor, sessionId };
}
