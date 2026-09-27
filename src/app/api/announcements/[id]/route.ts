import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

const OPTS = { allowLockedStudent: true };

async function loadEditable(req: NextRequest, id: string) {
  const authorization = await requireApiActor(req, ["admin", "teacher"], OPTS);
  if ("response" in authorization) return { response: authorization.response };
  const { actor } = authorization;
  const { data: row } = await actor.service.from("announcements").select("*").eq("id", id).maybeSingle();
  if (!row) return { response: NextResponse.json({ ok: false, error: "Announcement not found." }, { status: 404 }) };
  if (actor.role !== "admin" && row.author_user_id !== actor.dbUserId) {
    return { response: NextResponse.json({ ok: false, error: "You can only change your own announcements." }, { status: 403 }) };
  }
  return { actor, row };
}

/** PATCH { title?, body?, pinned?, expires_at? } — admins any; teachers only their own. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await loadEditable(req, params.id);
  if ("response" in loaded && loaded.response) return loaded.response;
  const { actor, row } = loaded as { actor: any; row: any };

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === "string") {
    const t = body.title.trim();
    if (!t || t.length > 160) return NextResponse.json({ ok: false, error: "Invalid title." }, { status: 400 });
    patch.title = t;
  }
  if (typeof body.body === "string") {
    const b = body.body.trim();
    if (!b || b.length > 5000) return NextResponse.json({ ok: false, error: "Invalid message." }, { status: 400 });
    patch.body = b;
  }
  if (actor.role === "admin" && typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if ("expires_at" in body) {
    if (!body.expires_at) patch.expires_at = null;
    else {
      const d = new Date(body.expires_at);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ ok: false, error: "Invalid expiry date." }, { status: 400 });
      patch.expires_at = d.toISOString();
    }
  }

  const { error } = await actor.service.from("announcements").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await logAudit(actor, {
    action: "announcement.edit",
    entityType: "announcement",
    entityId: params.id,
    summary: `Edited announcement "${patch.title || row.title}"`,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await loadEditable(req, params.id);
  if ("response" in loaded && loaded.response) return loaded.response;
  const { actor, row } = loaded as { actor: any; row: any };

  const { error } = await actor.service.from("announcements").delete().eq("id", params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await logAudit(actor, {
    action: "announcement.delete",
    entityType: "announcement",
    entityId: params.id,
    summary: `Deleted announcement "${row.title}"`,
  });
  return NextResponse.json({ ok: true });
}
