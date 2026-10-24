import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

/** The password the school hands out; signing in with it forces the student to choose their own. */
const DEFAULT_PASSWORD = "gracemark";
const MAX_SLIPS = 200;
const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

export type LoginStatus = "never_signed_in" | "password_not_changed" | "ok";

/**
 * GET ?class_id=   Every student with their sign-in state, read from the login system:
 *   never_signed_in       has not signed in even once
 *   password_not_changed  signed in but still has to choose a new password
 *   ok                    signed in and has their own password
 * POST { student_ids }   For students who have NEVER signed in only: sets the default password again
 *   (so a printed slip is guaranteed to be right) and returns the slip details. Anyone who has signed
 *   in is refused, so a student's own password is never overwritten.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const classId = req.nextUrl.searchParams.get("class_id") || "";
  let studentQuery = service.from("students").select("id, name, admission_no, user_id, classes:class_id(name)").order("name");
  if (classId) studentQuery = studentQuery.eq("class_id", classId);
  const { data: students, error } = await studentQuery;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const userIds = (students || []).map((s: any) => s.user_id).filter(Boolean);
  const { data: users } = userIds.length
    ? await service.from("users").select("id, auth_id, must_change_password").in("id", userIds)
    : { data: [] as any[] };
  const userById = new Map((users || []).map((u: any) => [u.id, u]));

  const lastSignIn = new Map<string, string | null>();
  for (let page = 1; page <= 20; page++) {
    const { data, error: listErr } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (listErr || !data?.users?.length) break;
    data.users.forEach((u: any) => lastSignIn.set(u.id, u.last_sign_in_at || null));
    if (data.users.length < 1000) break;
  }

  const items = (students || []).map((s: any) => {
    const u = userById.get(s.user_id) as any;
    const hasLogin = Boolean(u?.auth_id);
    const signedIn = hasLogin ? lastSignIn.get(u.auth_id) || null : null;
    const status: LoginStatus = !hasLogin || !signedIn ? "never_signed_in" : u?.must_change_password ? "password_not_changed" : "ok";
    return {
      id: s.id,
      name: s.name,
      admissionNo: s.admission_no,
      className: one(s.classes as any)?.name || "",
      hasLogin,
      lastSignInAt: signedIn,
      status,
    };
  });

  const counts = { never_signed_in: 0, password_not_changed: 0, ok: 0 };
  items.forEach((i) => counts[i.status]++);
  return NextResponse.json({ ok: true, counts, students: items });
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.student_ids) ? Array.from(new Set(body.student_ids.map(String))) : [];
  if (!ids.length) return NextResponse.json({ ok: false, error: "Select at least one student." }, { status: 400 });
  if (ids.length > MAX_SLIPS) return NextResponse.json({ ok: false, error: `Print at most ${MAX_SLIPS} slips at a time.` }, { status: 400 });

  const { data: students } = await service.from("students").select("id, name, admission_no, user_id, classes:class_id(name)").in("id", ids);
  const userIds = (students || []).map((s: any) => s.user_id).filter(Boolean);
  const { data: users } = userIds.length ? await service.from("users").select("id, auth_id").in("id", userIds) : { data: [] as any[] };
  const authByUser = new Map((users || []).map((u: any) => [u.id, u.auth_id as string | null]));

  const slips: { name: string; admissionNo: string; className: string; password: string }[] = [];
  const refused: { name: string; reason: string }[] = [];

  for (const s of (students || []) as any[]) {
    const authId = authByUser.get(s.user_id);
    if (!authId) {
      refused.push({ name: s.name, reason: "No login account yet. Reset them from Manage Students." });
      continue;
    }
    const { data: authUser } = await service.auth.admin.getUserById(authId);
    if (!authUser?.user) {
      refused.push({ name: s.name, reason: "Login account not found." });
      continue;
    }
    if (authUser.user.last_sign_in_at) {
      refused.push({ name: s.name, reason: "Has already signed in, so their password was not touched." });
      continue;
    }
    const { error: updErr } = await service.auth.admin.updateUserById(authId, { password: DEFAULT_PASSWORD, email_confirm: true });
    if (updErr) {
      refused.push({ name: s.name, reason: `Could not set the password: ${updErr.message}` });
      continue;
    }
    await service.from("users").update({ must_change_password: true }).eq("auth_id", authId);
    slips.push({ name: s.name, admissionNo: s.admission_no, className: one(s.classes as any)?.name || "", password: DEFAULT_PASSWORD });
  }

  await logAudit(actor, {
    action: "student_logins.slips",
    entityType: "students",
    summary: `Prepared ${slips.length} login slip(s) for students who had never signed in${refused.length ? `; ${refused.length} skipped` : ""}`,
    metadata: { prepared: slips.length, skipped: refused.length },
  });
  return NextResponse.json({ ok: true, slips, refused });
}
