import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

/** POST { endpoint, keys: { p256dh, auth } } — saves/updates this browser's push subscription. */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"], { allowLockedStudent: true });
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!actor.dbUserId) return NextResponse.json({ ok: false, error: "No user profile." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const endpoint = String(body?.endpoint || "").trim();
  const p256dh = String(body?.keys?.p256dh || "").trim();
  const auth = String(body?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: "endpoint and keys are required." }, { status: 400 });
  }

  const { error } = await actor.service.from("push_subscriptions").upsert(
    {
      user_id: actor.dbUserId,
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get("user-agent") || null,
    },
    { onConflict: "endpoint" }
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/** DELETE { endpoint } — removes this browser's push subscription (e.g. permission revoked). */
export async function DELETE(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"], { allowLockedStudent: true });
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;

  const body = await req.json().catch(() => null);
  const endpoint = String(body?.endpoint || "").trim();
  if (!endpoint) return NextResponse.json({ ok: false, error: "endpoint is required." }, { status: 400 });

  const { error } = await actor.service.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", actor.dbUserId || "");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
