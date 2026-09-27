import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

/**
 * POST { class_id, subject_id, term, action: "approve" | "return", reason? }
 * Approves or returns the SUBMITTED scores of one subject in one class
 * (current session). Drafts are left alone.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service, dbUserId } = authorization.actor;

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

  return NextResponse.json({ ok: true, updated: (data || []).length });
}
