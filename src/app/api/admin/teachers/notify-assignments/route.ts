import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, ApiActor } from "@/lib/apiAuth";
import { sendAssignmentUpdateEmail, AssignmentChange } from "@/lib/email";

type Service = ApiActor["service"];

interface PendingTeacher {
  teacherId: string;
  name: string;
  email: string | null;
  changes: AssignmentChange[];
  /** Rows to stamp once the email is delivered */
  stamps: { table: string; column: "notified_at" | "end_notified_at"; ids: string[] }[];
}

const MIGRATION_HINT =
  "Assignment notification tracking is not set up yet. Run supabase/024_assignment_notifications.sql in the Supabase SQL editor, then try again.";

function isMissingColumn(err: any) {
  return /notified_at/.test(err?.message || "") || err?.code === "42703" || err?.code === "PGRST204";
}

/** Collects every teacher who has un-notified assignment changes in the given session. */
async function collectPending(service: Service, sessionId: string | null): Promise<PendingTeacher[]> {
  const specs = [
    {
      table: "class_teacher_assignments",
      select: "id, teacher_user_id, status, notified_at, end_notified_at, classes(name)",
      role: "Class Teacher" as const,
    },
    {
      table: "subject_teacher_assignments",
      select: "id, teacher_user_id, status, notified_at, end_notified_at, classes(name), subjects(name)",
      role: "Subject Teacher" as const,
    },
  ];

  const rows: { table: string; role: AssignmentChange["role"]; row: any }[] = [];
  for (const spec of specs) {
    let q = service.from(spec.table).select(spec.select);
    if (sessionId) q = q.eq("academic_session_id", sessionId);
    const { data, error } = await q;
    if (error) throw error;
    (data || []).forEach((row: any) => rows.push({ table: spec.table, role: spec.role, row }));
  }

  const teacherKeys = Array.from(new Set(rows.map((r) => r.row.teacher_user_id).filter(Boolean)));
  const teacherByKey = new Map<string, any>();
  if (teacherKeys.length) {
    const { data: users } = await service
      .from("users")
      .select("id, auth_id, display_name, email, status")
      .or(`id.in.(${teacherKeys.join(",")}),auth_id.in.(${teacherKeys.join(",")})`);
    (users || []).forEach((u: any) => {
      teacherByKey.set(u.id, u);
      if (u.auth_id) teacherByKey.set(u.auth_id, u);
    });
  }

  const pending = new Map<string, PendingTeacher>();
  const one = (v: any) => (Array.isArray(v) ? v[0] : v);

  for (const { table, role, row } of rows) {
    const isActive = row.status === "active";
    // New assignment not yet announced, or an announced one that has since ended.
    // (Assigned and removed before ever being announced needs no email.)
    const kind: "added" | "removed" | null =
      isActive && !row.notified_at ? "added" : !isActive && row.notified_at && !row.end_notified_at ? "removed" : null;
    if (!kind) continue;

    const user = teacherByKey.get(row.teacher_user_id);
    if (!user) continue;

    let entry = pending.get(user.id);
    if (!entry) {
      entry = {
        teacherId: user.id,
        name: user.display_name || user.email || "Teacher",
        email: user.email || null,
        changes: [],
        stamps: [],
      };
      pending.set(user.id, entry);
    }
    entry.changes.push({
      kind,
      role,
      className: one(row.classes)?.name || "Class",
      subjectName: role === "Subject Teacher" ? one(row.subjects)?.name || "Subject" : undefined,
    });

    const column = kind === "added" ? "notified_at" : "end_notified_at";
    let stamp = entry.stamps.find((s) => s.table === table && s.column === column);
    if (!stamp) entry.stamps.push((stamp = { table, column, ids: [] }));
    stamp.ids.push(row.id);
  }

  return Array.from(pending.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function currentSession(service: Service) {
  const { data } = await service
    .from("academic_sessions")
    .select("id, name")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string, name: data.name as string } : null;
}

/** Preview: who would receive an email if the button were pressed now. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const session = await currentSession(service);
    const pending = await collectPending(service, session?.id || null);
    return NextResponse.json({
      ok: true,
      session: session?.name || "",
      teachers: pending.map((p) => ({
        teacherId: p.teacherId,
        name: p.name,
        email: p.email,
        changes: p.changes,
      })),
    });
  } catch (err: any) {
    if (isMissingColumn(err)) return NextResponse.json({ ok: false, error: MIGRATION_HINT }, { status: 409 });
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

/** Sends one email per teacher with un-notified changes, then marks those changes as notified. */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  if (!process.env.BREVO_API_KEY) {
    return NextResponse.json({ ok: false, error: "Email is not configured (BREVO_API_KEY is missing)." }, { status: 503 });
  }

  try {
    const session = await currentSession(service);
    const pending = await collectPending(service, session?.id || null);
    if (!pending.length) {
      return NextResponse.json({ ok: true, sent: 0, sentNames: [], failed: [], skipped: [] });
    }

    const sentNames: string[] = [];
    const failed: { name: string; error: string }[] = [];
    const skipped: string[] = [];
    const now = new Date().toISOString();

    for (const teacher of pending) {
      if (!teacher.email) {
        skipped.push(teacher.name);
        continue;
      }
      try {
        await sendAssignmentUpdateEmail({
          toEmail: teacher.email,
          name: teacher.name,
          session: session?.name || "",
          changes: teacher.changes,
        });
        for (const stamp of teacher.stamps) {
          const { error } = await service.from(stamp.table).update({ [stamp.column]: now }).in("id", stamp.ids);
          if (error) throw error;
        }
        sentNames.push(teacher.name);
      } catch (err: any) {
        failed.push({ name: teacher.name, error: err.message || "Send failed" });
      }
    }

    return NextResponse.json({ ok: true, sent: sentNames.length, sentNames, failed, skipped });
  } catch (err: any) {
    if (isMissingColumn(err)) return NextResponse.json({ ok: false, error: MIGRATION_HINT }, { status: 409 });
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
