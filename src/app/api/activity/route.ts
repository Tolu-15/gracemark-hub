import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

const TYPES = new Set(["page_view", "result_view", "result_print"]);
const METADATA_KEYS = ["milestone", "term", "session"] as const;

/** POST { type, path?, metadata? } — records one usage event for the signed-in user. Best-effort. */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"], { allowLockedStudent: true });
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!actor.dbUserId) return NextResponse.json({ ok: true });

  const body = await req.json().catch(() => null);
  const type = String(body?.type ?? "");
  if (!TYPES.has(type)) return NextResponse.json({ ok: false, error: "Unknown event type." }, { status: 400 });

  const path = typeof body?.path === "string" ? body.path.slice(0, 200) : null;
  const metadata: Record<string, string> = {};
  for (const key of METADATA_KEYS) {
    const value = body?.metadata?.[key];
    if (typeof value === "string" && value) metadata[key] = value.slice(0, 40);
  }

  const { error } = await actor.service.from("activity_events").insert({
    user_id: actor.dbUserId,
    role: actor.role,
    event_type: type,
    path,
    metadata,
  });
  if (error) console.warn("Activity event write failed:", error.message);

  return NextResponse.json({ ok: true });
}
