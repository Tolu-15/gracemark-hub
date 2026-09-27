import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

/** POST { ids: string[] } — marks announcements as read for the signed-in user (clears the badge). */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"], { allowLockedStudent: true });
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string").slice(0, 300) : [];
  if (!ids.length) return NextResponse.json({ ok: true });

  const { error } = await actor.service
    .from("announcement_reads")
    .upsert(ids.map((id) => ({ announcement_id: id, reader_auth_id: actor.authId })), { onConflict: "announcement_id,reader_auth_id" });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
