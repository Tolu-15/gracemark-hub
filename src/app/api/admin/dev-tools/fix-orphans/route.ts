import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

/**
 * POST — deletes every student-role login that has no student record attached
 * (same detection the scanner uses), removing both the public.users row and
 * the matching Supabase Auth user. Developer-only, same auth-cleanup pattern
 * already used by the teacher delete route.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!(await requireDeveloper(actor))) return NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 });
  const { service } = actor;

  const [{ data: students }, { data: users }] = await Promise.all([
    service.from("students").select("user_id"),
    service.from("users").select("id, auth_id, email, display_name, role").eq("role", "student"),
  ]);

  const claimedUserIds = new Set((students || []).map((s: any) => s.user_id).filter(Boolean));
  const orphans = (users || []).filter((u: any) => !claimedUserIds.has(u.id));

  const results: { email: string; deleted: boolean; authDeleted: boolean; error?: string }[] = [];

  for (const u of orphans as any[]) {
    const { error: delUserErr } = await service.from("users").delete().eq("id", u.id);
    if (delUserErr) {
      results.push({ email: u.email, deleted: false, authDeleted: false, error: delUserErr.message });
      continue;
    }

    let authDeleted = false;
    let authError: string | undefined;
    if (u.auth_id) {
      const { error: delAuthErr } = await service.auth.admin.deleteUser(u.auth_id);
      if (delAuthErr) authError = delAuthErr.message;
      else authDeleted = true;
    }
    results.push({ email: u.email, deleted: true, authDeleted, error: authError });
  }

  if (results.length > 0) {
    await logAudit(actor, {
      action: "dev_tools.fix_orphaned_accounts",
      entityType: "users",
      entityId: "bulk",
      summary: `Removed ${results.length} orphaned login account(s)`,
      metadata: { results },
    });
  }

  return NextResponse.json({ ok: true, removedCount: results.length, results });
}
