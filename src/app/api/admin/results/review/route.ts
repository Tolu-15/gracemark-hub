import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notify";

/**
 * POST { class_id, subject_id, term, action: "approve" | "return", reason? }
 * Approves or returns the SUBMITTED scores of one subject in one class
 * (current session). Drafts are left alone.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service, dbUserId } = actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const { class_id, subject_id, term, action, reason } = body || {};
  if (!class_id || !subject_id || !term || !["approve", "return"].includes(action)) {
    return NextResponse.json({ ok: false, error: "class_id, subject_id, term and a valid action are required." }, { status: 400 });
  }
  if (action === "return" && !String(reason || "").trim()) {
    return NextResponse.json({ ok: false, error: "Please tell the teacher what to correct." }, { status: 400 });
  }

  const { data: settings } = await service.from("app_settings").select("current_session").limit(1).maybeSingle();
  const session = settings?.current_session || "";
  const { data: students } = await service.from("students").select("id").eq("class_id", class_id);
  const studentIds = (students || []).map((s: any) => s.id);
  if (!studentIds.length) return NextResponse.json({ ok: true, updated: 0 });

  const update =
    action === "approve"
      ? { status: "approved", approved_by: dbUserId || null, return_reason: null }
      : { status: "returned", return_reason: String(reason).trim() };

  const { data, error } = await service
    .from("results")
    .update(update)
    .eq("subject_id", subject_id)
    .eq("term", term)
    .eq("session", session)
    .eq("status", "submitted")
    .in("student_id", studentIds)
    .select("id");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const updated = (data || []).length;

  if (updated > 0) {
    const [{ data: cls }, { data: sub }, { data: sessRow }] = await Promise.all([
      service.from("classes").select("name").eq("id", class_id).maybeSingle(),
      service.from("subjects").select("name").eq("id", subject_id).maybeSingle(),
      service.from("academic_sessions").select("id").eq("name", session).maybeSingle(),
    ]);

    let teacherIds: string[] = [];
    if (sessRow?.id) {
      const { data: assignments } = await service
        .from("subject_teacher_assignments")
        .select("teacher_user_id")
        .eq("class_id", class_id)
        .eq("subject_id", subject_id)
        .eq("academic_session_id", sessRow.id)
        .eq("status", "active");
      teacherIds = (assignments || []).map((a: any) => a.teacher_user_id).filter(Boolean);
    }

    await logAudit(actor, {
      action: action === "approve" ? "results.approve" : "results.return",
      entityType: "results",
      entityId: class_id,
      summary: `${action === "approve" ? "Approved" : "Returned"} ${updated} score record(s) — ${sub?.name || "subject"}, ${cls?.name || "class"} (${term}, ${session})${action === "return" ? `: ${String(reason).trim()}` : ""}`,
      metadata: { class_id, subject_id, term, session, updated, teacher_ids: teacherIds },
    });

    if (teacherIds.length) {
      await notifyUsers(actor, teacherIds, {
        type: action === "approve" ? "results.approve" : "results.return",
        title: action === "approve" ? "Scores approved" : "Scores returned for correction",
        body:
          action === "approve"
            ? `${sub?.name || "Your"} scores for ${cls?.name || "class"} (${term}, ${session}) were approved.`
            : `${sub?.name || "Your"} scores for ${cls?.name || "class"} (${term}, ${session}) were returned: ${String(reason).trim()}`,
        link: "/teacher/score-entry",
        metadata: { class_id, subject_id, term, session, reason: action === "return" ? String(reason).trim() : undefined },
      });
    }
  }

  return NextResponse.json({ ok: true, updated });
}
