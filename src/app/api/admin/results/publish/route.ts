import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { notifyUsers, notifyAdmins } from "@/lib/notify";
import { sendResultPublishedEmail, sendGuardianResultPublishedEmail } from "@/lib/email";
import { applyLevelWidePositions, buildClassReports, Milestone, MILESTONES } from "@/lib/reportBuilder";
import { usersByAnyId } from "@/lib/serverContext";
import { awardPositionBadges } from "@/lib/badges";

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
    const { data: version, error: versionError } = await service.rpc("publication_version", {
      p_class: class_id, p_session: session, p_term: term,
    });
    if (versionError) throw versionError;
    const build = await buildClassReports(service, { classId: class_id, term, session, milestone });

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

    await applyLevelWidePositions(service, build);
    const publishedAt = new Date().toISOString();
    const { data: published, error } = await service.rpc("commit_publication", {
      p_class: class_id, p_session: session, p_term: term, p_type: milestone, p_actor: dbUserId,
      p_version: version, p_reports: build.reports, p_results: build.resultIds, p_at: publishedAt, p_recall: false,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });

    if (milestone === "TR") {
      await awardPositionBadges(service, build.reports, term, session);
    }

    const { data: students } = await service.from("students").select("id, user_id, name, full_name, guardian_email").eq("class_id", class_id);
    const { data: cls } = await service.from("classes").select("name").eq("id", class_id).maybeSingle();
    await logAudit(actor, {
      action: "results.publish",
      entityType: "class",
      entityId: class_id,
      summary: `Published ${milestone} for ${cls?.name || "class"} (${term}, ${session}) — ${published} students${force ? " (forced past warnings)" : ""}`,
      metadata: { class_id, term, session, milestone, students: published, forced: Boolean(force) },
    });

    const publishedStudentIds = new Set(build.reports.map(r => r.student.id));
    const rawUserIds = (students || []).filter(s => publishedStudentIds.has(s.id)).map((s: any) => s.user_id).filter(Boolean);
    if (rawUserIds.length) {
      const userMap = await usersByAnyId(service, rawUserIds);
      const recipientIds = Array.from(new Set(Array.from(userMap.values()).map((u) => u.id)));
      await notifyUsers(actor, recipientIds, {
        type: "results.publish",
        title: "New result published",
        body: `Your ${milestone.replace(/_/g, " ")} for ${cls?.name || "your class"} (${term}, ${session}) is now available.`,
        link: "/student/result",
        metadata: { class_id, term, session, milestone },
      });
    }

    // Push notifications also reach admin and this class's teachers — anyone
    // who has push enabled gets pinged, not just the students whose result it is.
    await notifyAdmins(actor, {
      type: "results.publish",
      title: "Result published",
      body: `${milestone.replace(/_/g, " ")} for ${cls?.name || "a class"} (${term}, ${session}) was published — ${published} students.`,
      link: "/admin/historical-results",
      metadata: { class_id, term, session, milestone },
    });

    const [{ data: cta }, { data: sta }, { data: classRow }] = await Promise.all([
      service.from("class_teacher_assignments").select("teacher_user_id").eq("class_id", class_id).eq("status", "active"),
      service.from("subject_teacher_assignments").select("teacher_user_id").eq("class_id", class_id).eq("status", "active"),
      service.from("classes").select("class_teacher_id").eq("id", class_id).maybeSingle(),
    ]);
    const rawTeacherIds = [...(cta || []).map((r: any) => r.teacher_user_id), ...(sta || []).map((r: any) => r.teacher_user_id), classRow?.class_teacher_id].filter(
      Boolean
    );
    const teacherUserMap = await usersByAnyId(service, rawTeacherIds);
    const teacherIds = Array.from(new Set(Array.from(teacherUserMap.values()).map((u) => u.id)));
    if (teacherIds.length) {
      await notifyUsers(actor, teacherIds, {
        type: "results.publish",
        title: "Result published",
        body: `${milestone.replace(/_/g, " ")} for ${cls?.name || "your class"} (${term}, ${session}) was published.`,
        link: "/teacher/gradebook",
        metadata: { class_id, term, session, milestone },
      });
    }

    // Best-effort — a mail provider hiccup must never undo or block a publish.
    try {
      await sendResultPublishedEmail({
        className: cls?.name || "a class",
        milestone,
        term,
        session,
        studentCount: published,
      });
    } catch (mailErr) {
      console.warn("Result-published email failed:", mailErr);
    }

    // One best-effort email per guardian who has an email on file, for the
    // students actually included in this publish. Never lets one bad address
    // block the rest, and never blocks or undoes the publish itself.
    const guardianTargets = (students || []).filter((s: any) => publishedStudentIds.has(s.id) && s.guardian_email);
    await Promise.allSettled(
      guardianTargets.map((s: any) =>
        sendGuardianResultPublishedEmail({
          guardianEmail: s.guardian_email,
          studentName: s.full_name || s.name || "Your ward",
          className: cls?.name || "their class",
          milestone,
          term,
          session,
        }).catch((err) => console.warn(`Guardian email failed for student ${s.id}:`, err))
      )
    );

    return NextResponse.json({ ok: true, published: published, publishedAt });
  } catch (err: any) {
    console.error("Publish error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Failed to publish." }, { status: 500 });
  }
}
