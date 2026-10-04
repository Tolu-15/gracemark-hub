import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

export interface PendingActionItem {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  term: string;
  reason: string;
  count: number;
}

/**
 * GET — single source of truth for "what needs my attention" across the
 * score approval workflow, so the count shown as a nav badge always matches
 * the feed shown on the dashboard.
 *
 * Admin: subject/class/term groups with scores awaiting review (status = submitted).
 * Teacher: subject/class/term groups the admin sent back for correction (status = returned),
 * restricted to subjects the teacher is actively assigned to.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service, role } = actor;

  const { data: settings } = await service.from("app_settings").select("current_session").limit(1).maybeSingle();
  const session = settings?.current_session || "";

  if (role === "admin") {
    const { data: rows, error } = await service
      .from("results")
      .select("class_id, subject_id, term, classes(name), subjects(name)")
      .eq("status", "submitted")
      .eq("session", session);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const items = groupResults(rows || [], "");
    return NextResponse.json({ ok: true, role, count: items.length, items });
  }

  // Teacher: only subjects/classes they are actively assigned to this session.
  const idList = Array.from(new Set([actor.authId, actor.dbUserId].filter(Boolean)));
  const { data: assignments } = await service
    .from("subject_teacher_assignments")
    .select("class_id, subject_id")
    .in("teacher_user_id", idList)
    .eq("status", "active");

  const pairs = new Set((assignments || []).map((a: any) => `${a.class_id}:${a.subject_id}`));
  if (!pairs.size) return NextResponse.json({ ok: true, role, count: 0, items: [] });

  const classIds = Array.from(new Set((assignments || []).map((a: any) => a.class_id)));
  const { data: rows, error } = await service
    .from("results")
    .select("class_id, subject_id, term, return_reason, classes(name), subjects(name)")
    .eq("status", "returned")
    .eq("session", session)
    .in("class_id", classIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const filtered = (rows || []).filter((r: any) => pairs.has(`${r.class_id}:${r.subject_id}`));
  const items = groupResults(filtered, "return_reason");
  return NextResponse.json({ ok: true, role, count: items.length, items });
}

function groupResults(rows: any[], reasonField: string): PendingActionItem[] {
  const grouped = new Map<string, PendingActionItem>();
  for (const r of rows) {
    const key = `${r.class_id}:${r.subject_id}:${r.term}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, {
      classId: r.class_id,
      className: r.classes?.name || "",
      subjectId: r.subject_id,
      subjectName: r.subjects?.name || "",
      term: r.term,
      reason: reasonField ? r[reasonField] || "" : "",
      count: 1,
    });
  }
  return Array.from(grouped.values());
}
