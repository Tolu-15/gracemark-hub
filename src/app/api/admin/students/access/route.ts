import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

/** POST { id, locked, reason? } — locks or unlocks a student's portal access. */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;

  const body = await req.json().catch(() => null);
  const id = String(body?.id || "");
  const locked = Boolean(body?.locked);
  const reason = locked ? String(body?.reason || "Outstanding school fees").trim() : null;
  if (!id) return NextResponse.json({ ok: false, error: "Student id is required." }, { status: 400 });

  const { data: student } = await actor.service.from("students").select("*").eq("id", id).maybeSingle();
  if (!student) return NextResponse.json({ ok: false, error: "Student not found." }, { status: 404 });

  const { error } = await actor.service
    .from("students")
    .update({ portal_access_status: locked ? "locked" : "active", portal_lock_reason: reason })
    .eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const name = (student as any).name || (student as any).full_name || "Student";
  const adm = (student as any).admission_no || "—";
  await logAudit(actor, {
    action: locked ? "student.lock" : "student.unlock",
    entityType: "student",
    entityId: id,
    summary: `${locked ? "Locked" : "Unlocked"} portal access for ${name} (${adm})${reason ? `: ${reason}` : ""}`,
    metadata: { name, admission_no: adm, reason },
  });
  return NextResponse.json({ ok: true });
}
