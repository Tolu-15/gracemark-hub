import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { isEmailConfigured, sendCustomEmail } from "@/lib/email";
import { loadRecipientGroups } from "@/lib/emailRecipients";

/** A bulk send can take a while: each message is a separate request to the mail provider. */
export const maxDuration = 60;

const MAX_RECIPIENTS = 100;
const BATCH = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function authorize(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization;
  if (!(await requireDeveloper(authorization.actor))) {
    return { response: NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 }) };
  }
  return authorization;
}

/** GET ?q= — the people the developer can email, grouped. */
export async function GET(req: NextRequest) {
  const authorization = await authorize(req);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const groups = await loadRecipientGroups(service);
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  const filter = (list: typeof groups.teachers) => (q ? list.filter((r) => `${r.name} ${r.email} ${r.detail}`.toLowerCase().includes(q)) : list);
  return NextResponse.json({
    ok: true,
    configured: isEmailConfigured(),
    maxRecipients: MAX_RECIPIENTS,
    counts: { teachers: groups.teachers.length, admins: groups.admins.length, guardians: groups.guardians.length },
    teachers: filter(groups.teachers),
    admins: filter(groups.admins),
    guardians: filter(groups.guardians),
  });
}

/**
 * POST { subject, message, emails?: string[], test?: boolean }
 * `test` sends one copy to the signed-in developer only. Otherwise every address must be on the
 * recipient list above (teachers, admins, guardians), at most 100 per send. One message per person,
 * so nobody sees anyone else's address. The audit log records who sent what and how many, not the
 * addresses.
 */
export async function POST(req: NextRequest) {
  const authorization = await authorize(req);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  if (!isEmailConfigured()) {
    return NextResponse.json({ ok: false, error: "Email is not configured on the server (BREVO_API_KEY is missing)." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const subject = String(body?.subject || "").trim();
  const message = String(body?.message || "").trim();
  if (!subject || subject.length > 150) return NextResponse.json({ ok: false, error: "Subject is required (up to 150 characters)." }, { status: 400 });
  if (!message || message.length > 5000) return NextResponse.json({ ok: false, error: "Message is required (up to 5,000 characters)." }, { status: 400 });

  type Target = { email: string; name?: string };
  let targets: Target[];

  if (body?.test === true) {
    if (!actor.email) return NextResponse.json({ ok: false, error: "Your account has no email address." }, { status: 400 });
    targets = [{ email: actor.email }];
  } else {
    const requested: string[] = Array.isArray(body?.emails) ? body.emails.map((e: unknown) => String(e).trim()).filter(Boolean) : [];
    const unique = Array.from(new Map(requested.map((e) => [e.toLowerCase(), e])).values());
    if (!unique.length) return NextResponse.json({ ok: false, error: "Select at least one recipient." }, { status: 400 });
    if (unique.length > MAX_RECIPIENTS) {
      return NextResponse.json({ ok: false, error: `Send at most ${MAX_RECIPIENTS} at a time.` }, { status: 400 });
    }
    if (unique.some((e) => !EMAIL_RE.test(e))) return NextResponse.json({ ok: false, error: "One of the selected addresses is not valid." }, { status: 400 });

    const groups = await loadRecipientGroups(service);
    const allowed = new Map<string, { name: string; isGuardian: boolean }>();
    groups.teachers.concat(groups.admins).forEach((r) => allowed.set(r.email.toLowerCase(), { name: r.name, isGuardian: false }));
    groups.guardians.forEach((r) => !allowed.has(r.email.toLowerCase()) && allowed.set(r.email.toLowerCase(), { name: r.name, isGuardian: true }));

    const unknown = unique.filter((e) => !allowed.has(e.toLowerCase()));
    if (unknown.length) {
      return NextResponse.json({ ok: false, error: `${unknown.length} selected address${unknown.length === 1 ? " is" : "es are"} not on the recipient list.` }, { status: 400 });
    }
    // Staff are greeted by name; guardians get "Dear Guardian" (their entry's name is "Guardian of …").
    targets = unique.map((e) => {
      const hit = allowed.get(e.toLowerCase())!;
      return { email: e, name: hit.isGuardian ? undefined : hit.name };
    });
  }

  const results: { email: string; ok: boolean; error?: string }[] = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      chunk.map((t) => sendCustomEmail({ toEmail: t.email, toName: t.name, subject: body?.test === true ? `[TEST] ${subject}` : subject, message }))
    );
    settled.forEach((r, idx) =>
      results.push(r.status === "fulfilled" ? { email: chunk[idx].email, ok: true } : { email: chunk[idx].email, ok: false, error: (r.reason as Error)?.message || "Send failed." })
    );
  }

  const sent = results.filter((r) => r.ok).length;
  await logAudit(actor, {
    action: body?.test === true ? "dev_tools.email_test" : "dev_tools.email_send",
    entityType: "email",
    summary: `${body?.test === true ? "Sent a test email" : `Emailed ${sent} of ${targets.length} recipient(s)`}: "${subject.slice(0, 80)}"`,
    metadata: { subject, attempted: targets.length, sent, failed: targets.length - sent },
  });
  return NextResponse.json({ ok: true, sent, failed: targets.length - sent, results: results.filter((r) => !r.ok) });
}
