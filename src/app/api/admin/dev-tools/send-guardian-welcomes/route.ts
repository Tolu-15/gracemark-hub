import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { sendGuardianWelcomeEmail } from "@/lib/email";

/**
 * POST — sends the guardian welcome email to every student whose guardian email
 * is on file but hasn't been welcomed yet (guardian_welcome_sent_at is null),
 * then stamps each one so a second click never double-sends.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!(await requireDeveloper(actor))) return NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 });
  const { service } = actor;

  const { data: students, error } = await service
    .from("students")
    .select("id, name, full_name, guardian_email, classes:class_id(name)")
    .not("guardian_email", "is", null)
    .neq("guardian_email", "")
    .is("guardian_welcome_sent_at", null)
    .or("is_alumni.is.null,is_alumni.eq.false");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const results: { name: string; email: string; sent: boolean; error?: string }[] = [];
  for (const s of (students || []) as any[]) {
    const name = s.full_name || s.name || "Student";
    try {
      await sendGuardianWelcomeEmail({ guardianEmail: s.guardian_email, studentName: name, className: s.classes?.name || "their class" });
      await service.from("students").update({ guardian_welcome_sent_at: new Date().toISOString() }).eq("id", s.id);
      results.push({ name, email: s.guardian_email, sent: true });
    } catch (err: any) {
      results.push({ name, email: s.guardian_email, sent: false, error: err?.message || "Send failed" });
    }
  }

  const sentCount = results.filter((r) => r.sent).length;
  await logAudit(actor, {
    action: "guardians.welcome_bulk",
    entityType: "students",
    summary: `Sent guardian welcome email to ${sentCount} of ${results.length} guardian(s)`,
    metadata: { sent: sentCount, failed: results.length - sentCount },
  });

  return NextResponse.json({ ok: true, sentCount, failedCount: results.length - sentCount, results });
}
