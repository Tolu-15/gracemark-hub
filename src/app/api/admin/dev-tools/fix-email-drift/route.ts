import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

function deriveEmail(admissionNo: string) {
  return `${admissionNo.trim().replace(/[^A-Z0-9]/gi, "").toLowerCase()}@student.gracemark.edu.ng`;
}

/**
 * POST — re-syncs every student login email that has drifted from what their
 * current admission number would generate (same detection the scanner uses),
 * updating both public.users and the Supabase Auth user. Never touches a
 * deliberately customized email, same guard the scanner uses. Skips, rather
 * than overwrites, any case where the expected email is already taken by a
 * different account — same collision guard as the single-student sync-login
 * route this mirrors.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!(await requireDeveloper(actor))) return NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 });
  const { service } = actor;

  const [{ data: students }, { data: users }] = await Promise.all([
    service.from("students").select("id, name, full_name, admission_no, user_id"),
    service.from("users").select("id, auth_id, email, display_name"),
  ]);

  const userById = new Map((users || []).map((u: any) => [u.id, u]));
  const userByEmail = new Map((users || []).map((u: any) => [String(u.email || "").toLowerCase(), u]));

  const drifted = (students || [])
    .map((s: any) => {
      const user = userById.get(s.user_id);
      if (!user?.email) return null;
      const expected = deriveEmail(s.admission_no || "");
      const current = String(user.email).toLowerCase();
      if (current.endsWith("@student.gracemark.edu.ng") && current !== expected) {
        return { student: s, user, expected };
      }
      return null;
    })
    .filter((x): x is { student: any; user: any; expected: string } => x !== null);

  const results: { name: string; from: string; to: string; fixed: boolean; error?: string }[] = [];

  for (const { student, user, expected } of drifted) {
    const name = student.full_name || student.name || "Student";
    const collision = userByEmail.get(expected);
    if (collision && collision.id !== user.id) {
      results.push({ name, from: user.email, to: expected, fixed: false, error: `${expected} is already used by another account (${collision.display_name || "another user"}).` });
      continue;
    }

    const { error: authErr } = await service.auth.admin.updateUserById(user.auth_id, { email: expected, email_confirm: true });
    if (authErr) {
      results.push({ name, from: user.email, to: expected, fixed: false, error: authErr.message });
      continue;
    }
    const { error: dbErr } = await service.from("users").update({ email: expected }).eq("id", user.id);
    if (dbErr) {
      results.push({ name, from: user.email, to: expected, fixed: false, error: dbErr.message });
      continue;
    }
    results.push({ name, from: user.email, to: expected, fixed: true });
  }

  const fixedCount = results.filter((r) => r.fixed).length;
  if (results.length > 0) {
    await logAudit(actor, {
      action: "dev_tools.fix_email_drift",
      entityType: "users",
      entityId: "bulk",
      summary: `Re-synced ${fixedCount} of ${results.length} drifted login email(s)`,
      metadata: { results },
    });
  }

  return NextResponse.json({ ok: true, fixedCount, results });
}
