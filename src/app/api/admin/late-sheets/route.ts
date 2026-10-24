import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { isEmailConfigured, sendCustomEmail } from "@/lib/email";
import { notifyUsers } from "@/lib/notify";
import { computeLateSheets, TERM_LABEL, type LateTeacher } from "@/lib/lateSheets";

/** One reminder per teacher per 12 hours, so a double-click or a second admin can't spam them. */
const COOLDOWN_MS = 12 * 3_600_000;
const MAX_TEACHERS = 50;

async function lastReminders(service: any, teacherIds: string[]) {
  const map = new Map<string, string>();
  if (!teacherIds.length) return map;
  const { data } = await service
    .from("audit_logs")
    .select("entity_id, created_at")
    .eq("action", "late_sheets.reminder")
    .in("entity_id", teacherIds)
    .order("created_at", { ascending: false })
    .limit(500);
  (data || []).forEach((r: any) => !map.has(r.entity_id) && map.set(r.entity_id, r.created_at));
  return map;
}

/** GET — teachers with score sheets that are not fully submitted this term, and when each was last reminded. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const report = await computeLateSheets(service);
    const reminded = await lastReminders(service, report.teachers.map((t) => t.userId));
    return NextResponse.json({
      ok: true,
      ...report,
      emailConfigured: isEmailConfigured(),
      teachers: report.teachers.map((t) => ({ ...t, lastRemindedAt: reminded.get(t.userId) || null })),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Could not load score sheets." }, { status: 500 });
  }
}

function buildMessage(teacher: LateTeacher, termLabel: string, session: string, note: string) {
  const lines = teacher.sheets.map((s) => {
    const parts = [`${s.done} of ${s.expected} students submitted`];
    if (s.draft) parts.push(`${s.draft} still in draft`);
    if (s.returned) parts.push(`${s.returned} returned for correction`);
    if (s.state === "not_started") parts.push("not started");
    return `• ${s.subjectName}, ${s.className}: ${parts.join(", ")}`;
  });
  return [
    `This is a reminder from the school office. These score sheets for ${termLabel}, ${session} are not yet complete:`,
    "",
    ...lines,
    "",
    'Please sign in to the portal, finish entering the scores and press "Submit to Admin" as soon as you can.',
    ...(note ? ["", note] : []),
    "",
    "Thank you.",
  ].join("\n");
}

/**
 * POST { teacher_ids: string[], note?: string } — reminds each selected teacher by email and in the
 * portal. The list of late sheets is recomputed here, never taken from the browser, and a teacher
 * reminded in the last 12 hours is skipped.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.teacher_ids) ? Array.from(new Set(body.teacher_ids.map(String))) : [];
  const note = String(body?.note || "").trim().slice(0, 1000);
  if (!ids.length) return NextResponse.json({ ok: false, error: "Select at least one teacher." }, { status: 400 });
  if (ids.length > MAX_TEACHERS) return NextResponse.json({ ok: false, error: `Remind at most ${MAX_TEACHERS} teachers at a time.` }, { status: 400 });

  const report = await computeLateSheets(service);
  const reminded = await lastReminders(service, ids);
  const termLabel = TERM_LABEL[report.term] || report.term;
  const emailOn = isEmailConfigured();

  const results: { teacherId: string; name: string; status: "sent" | "skipped" | "failed"; detail: string }[] = [];
  for (const id of ids) {
    const teacher = report.teachers.find((t) => t.userId === id);
    if (!teacher) {
      results.push({ teacherId: id, name: "", status: "skipped", detail: "No outstanding sheets." });
      continue;
    }
    const last = reminded.get(id);
    if (last && Date.now() - new Date(last).getTime() < COOLDOWN_MS) {
      results.push({ teacherId: id, name: teacher.name, status: "skipped", detail: "Reminded in the last 12 hours." });
      continue;
    }

    const message = buildMessage(teacher, termLabel, report.session, note);
    let emailed = false;
    let detail = "In-portal reminder sent.";
    if (emailOn && teacher.email) {
      try {
        await sendCustomEmail({ toEmail: teacher.email, toName: teacher.name, subject: `Reminder: ${teacher.sheets.length} score sheet${teacher.sheets.length === 1 ? "" : "s"} still to submit`, message });
        emailed = true;
        detail = "Emailed and sent an in-portal reminder.";
      } catch (err: any) {
        detail = `In-portal reminder sent, but the email failed (${err?.message || "error"}).`;
      }
    } else if (!teacher.email) {
      detail = "In-portal reminder sent (no email address on file).";
    } else {
      detail = "In-portal reminder sent (email is not configured).";
    }

    await notifyUsers(actor, [teacher.userId], {
      type: "scores.reminder",
      title: `${teacher.sheets.length} score sheet${teacher.sheets.length === 1 ? "" : "s"} still to submit`,
      body: teacher.sheets.slice(0, 3).map((s) => `${s.subjectName} (${s.className})`).join(", ") + (teacher.sheets.length > 3 ? ` and ${teacher.sheets.length - 3} more` : ""),
      link: "/teacher/score-entry",
      metadata: { term: report.term, session: report.session },
    });
    await logAudit(actor, {
      action: "late_sheets.reminder",
      entityType: "user",
      entityId: teacher.userId,
      summary: `Reminded ${teacher.name} about ${teacher.sheets.length} score sheet(s) (${termLabel}, ${report.session})${emailed ? " by email" : ""}`,
      metadata: { sheets: teacher.sheets.length, emailed },
    });
    results.push({ teacherId: id, name: teacher.name, status: "sent", detail });
  }

  return NextResponse.json({ ok: true, results });
}
