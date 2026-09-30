import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { requireApiActor } from "@/lib/apiAuth";

/**
 * GET — self-diagnostic: reports whether the server has VAPID keys configured,
 * and sends a real test push to every subscription the caller owns, returning
 * each attempt's actual outcome instead of the silent console.warn a normal
 * notification send uses. Never touches other users' subscriptions.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"], { allowLockedStudent: true });
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!actor.dbUserId) return NextResponse.json({ ok: false, error: "No user profile." }, { status: 400 });

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const vapidConfigured = Boolean(publicKey && privateKey);

  const { data: subs, error: subsErr } = await actor.service
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, user_agent, created_at")
    .eq("user_id", actor.dbUserId);
  if (subsErr) return NextResponse.json({ ok: false, error: subsErr.message }, { status: 500 });

  if (!vapidConfigured) {
    return NextResponse.json({
      ok: true,
      vapidConfigured,
      subscriptionCount: subs?.length || 0,
      results: [],
      diagnosis: "VAPID keys are not configured on the server (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) — every push send is silently skipped, for every user.",
    });
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:noreply@gracemarkportal.com.ng", publicKey, privateKey);

  const payload = JSON.stringify({ title: "Test notification", body: "If you see this, push notifications are working.", link: "/" });
  const results = await Promise.all(
    (subs || []).map(async (sub: any) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        return { id: sub.id, endpoint: sub.endpoint, userAgent: sub.user_agent, ok: true };
      } catch (err: any) {
        return {
          id: sub.id,
          endpoint: sub.endpoint,
          userAgent: sub.user_agent,
          ok: false,
          statusCode: err?.statusCode ?? null,
          error: err?.body || err?.message || String(err),
        };
      }
    })
  );

  return NextResponse.json({
    ok: true,
    vapidConfigured,
    subscriptionCount: subs?.length || 0,
    results,
    diagnosis: !subs?.length
      ? "No push subscription is registered for this account — enable notifications from the bell dropdown first."
      : results.every((r) => r.ok)
        ? "All subscriptions accepted the test push. If it still didn't arrive, the OS/browser is likely blocking or delaying it on the device side."
        : "At least one subscription rejected the test push — see each result's statusCode/error.",
  });
}

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
