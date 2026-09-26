import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { buildClassReports, ensureEnrollments, Milestone, MILESTONES, STATUS_COLUMN } from "@/lib/reportBuilder";

/**
 * POST { class_id, term, milestone, force? }
 * Publishes one milestone for one class in the current session. Each
 * student's report is frozen into result_snapshots; students only ever see
 * that copy. Blocked while any score is unapproved; other warnings need
 * `force: true` (the admin confirmed "Publish anyway").
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service, dbUserId } = authorization.actor;
  const actor = authorization.actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const { class_id, term, force } = body || {};
  const milestone = body?.milestone as Milestone;
  if (!class_id || !term || !MILESTONES.includes(milestone)) {
    return NextResponse.json({ ok: false, error: "class_id, term and milestone are required." }, { status: 400 });
  }
  if (!dbUserId) {
    return NextResponse.json({ ok: false, error: "Your admin account has no user profile." }, { status: 400 });
  }

  const { data: settings } = await service.from("app_settings").select("current_session").limit(1).maybeSingle();
  const session = settings?.current_session || "";
  if (!session) return NextResponse.json({ ok: false, error: "No current session is set in settings." }, { status: 400 });

  try {
    let build = await buildClassReports(service, { classId: class_id, term, session, milestone });

    const blocking = build.issues.filter((i) => i.level === "block");
    if (blocking.length) {
      return NextResponse.json({ ok: false, blocked: true, issues: build.issues, error: "Fix the blocking issues before publishing." }, { status: 409 });
    }
    if (build.issues.length && !force) {
      return NextResponse.json({ ok: false, needsConfirm: true, issues: build.issues }, { status: 409 });
    }
    if (!build.reports.length) {
      return NextResponse.json({ ok: false, error: "There are no scores to publish yet." }, { status: 400 });
    }
    if (!build.sessionId) {
      return NextResponse.json({ ok: false, error: `Academic session "${session}" was not found.` }, { status: 400 });
    }

    // Every student needs an enrollment for the session to hold a snapshot.
    const missing = build.reports.map((r) => r.student.id).filter((id) => !build.enrollmentByStudent.has(id));
    if (missing.length) {
      await ensureEnrollments(service, class_id, build.sessionId, missing);
      build = await buildClassReports(service, { classId: class_id, term, session, milestone });
    }

    const publishedAt = new Date().toISOString();
    const snapshots = build.reports.map((report) => ({
      enrollment_id: build.enrollmentByStudent.get(report.student.id),
      term,
      report_type: milestone,
      snapshot_data: report,
      published_by: dbUserId,
      published_at: publishedAt,
    }));

    const { error: snapErr } = await service
      .from("result_snapshots")
      .upsert(snapshots, { onConflict: "enrollment_id,term,report_type" });
    if (snapErr) throw snapErr;

    // Remove snapshots of students in the class who no longer have a report
    const keep = new Set(snapshots.map((s) => s.enrollment_id));
    const stale = Array.from(build.enrollmentByStudent.values()).filter((id) => !keep.has(id));
    if (stale.length) {
      await service.from("result_snapshots").delete().eq("term", term).eq("report_type", milestone).in("enrollment_id", stale);
    }

    // Mark exactly the included result rows as published for this milestone
    const col = STATUS_COLUMN[milestone];
    const { data: students } = await service.from("students").select("id").eq("class_id", class_id);
    const studentIds = (students || []).map((s: any) => s.id);
    await service.from("results").update({ [col]: "draft" }).eq("term", term).eq("session", session).in("student_id", studentIds);
    const { error: stErr } = await service.from("results").update({ [col]: "published", published_at: publishedAt }).in("id", build.resultIds);
    if (stErr) throw stErr;

    const { data: cls } = await service.from("classes").select("name").eq("id", class_id).maybeSingle();
    await logAudit(actor, {
      action: "results.publish",
      entityType: "class",
      entityId: class_id,
      summary: `Published ${milestone} for ${cls?.name || "class"} (${term}, ${session}) — ${snapshots.length} students${force ? " (forced past warnings)" : ""}`,
      metadata: { class_id, term, session, milestone, students: snapshots.length, forced: Boolean(force) },
    });

    return NextResponse.json({ ok: true, published: snapshots.length, publishedAt });
  } catch (err: any) {
    console.error("Publish error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Failed to publish." }, { status: 500 });
  }
}
