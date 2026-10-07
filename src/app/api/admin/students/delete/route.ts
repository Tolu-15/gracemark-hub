import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

/** POST { id } — permanently deletes a student (cascades to enrollments, results, attendance). */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;

  const body = await req.json().catch(() => null);
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "Student id is required." }, { status: 400 });

  const { data: student } = await actor.service.from("students").select("*").eq("id", id).maybeSingle();
  if (!student) return NextResponse.json({ ok: false, error: "Student not found." }, { status: 404 });

  const userId = (student as any).user_id as string | null;
  let authId: string | null = null;
  if (userId) {
    const { data: user } = await actor.service.from("users").select("auth_id").eq("id", userId).maybeSingle();
    authId = (user as any)?.auth_id || null;
  }

  const { error } = await actor.service.from("students").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let authDeleted = false;
  let authError: string | null = null;
  if (userId) {
    const { error: delUserErr } = await actor.service.from("users").delete().eq("id", userId);
    if (delUserErr) console.error("Error deleting from public.users:", delUserErr);

    if (authId) {
      const { error: delAuthErr } = await actor.service.auth.admin.deleteUser(authId);
      if (delAuthErr) {
        console.warn(`Could not delete Supabase auth user (${authId}):`, delAuthErr.message);
        authError = delAuthErr.message;
      } else {
        authDeleted = true;
      }
    }
  }

  const name = (student as any).name || (student as any).full_name || "Student";
  await logAudit(actor, {
    action: "student.delete",
    entityType: "student",
    entityId: id,
    summary: `Deleted student ${name} (${(student as any).admission_no || "no admission no"})`,
    metadata: { name, admission_no: (student as any).admission_no, authDeleted, authError },
  });
  return NextResponse.json({ ok: true, authDeleted, authError });
}
