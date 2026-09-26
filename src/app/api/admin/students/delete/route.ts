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

  const { error } = await actor.service.from("students").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const name = (student as any).name || (student as any).full_name || "Student";
  await logAudit(actor, {
    action: "student.delete",
    entityType: "student",
    entityId: id,
    summary: `Deleted student ${name} (${(student as any).admission_no || "no admission no"})`,
    metadata: { name, admission_no: (student as any).admission_no },
  });
  return NextResponse.json({ ok: true });
}
