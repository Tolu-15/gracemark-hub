import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

/**
 * GET ?summary=1 -> { ok, unreadCount }
 * GET             -> { ok, notifications, unreadCount }
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"], { allowLockedStudent: true });
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!actor.dbUserId) return NextResponse.json({ ok: true, notifications: [], unreadCount: 0 });

  const sp = req.nextUrl.searchParams;

  const { count } = await actor.service
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", actor.dbUserId)
    .is("read_at", null);
  const unreadCount = count || 0;

  if (sp.get("summary") === "1") {
    return NextResponse.json({ ok: true, unreadCount });
  }

  const { data, error } = await actor.service
    .from("notifications")
    .select("id, created_at, type, title, body, link, read_at, actor_role")
    .eq("recipient_user_id", actor.dbUserId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, notifications: data || [], unreadCount });
}

/**
 * PATCH { ids?: string[], all?: boolean } — marks notifications as read for the caller.
 */
export async function PATCH(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"], { allowLockedStudent: true });
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!actor.dbUserId) return NextResponse.json({ ok: true });

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string") : [];
  const all = Boolean(body?.all);
  if (!all && !ids.length) return NextResponse.json({ ok: false, error: "ids or all is required." }, { status: 400 });

  let query = actor.service
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", actor.dbUserId)
    .is("read_at", null);
  if (!all) query = query.in("id", ids);

  const { error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
