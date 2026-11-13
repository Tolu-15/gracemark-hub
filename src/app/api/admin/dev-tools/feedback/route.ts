import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";

const statuses = new Set(["new", "in_progress", "resolved"]);

async function authorizeDeveloper(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization;
  if (!(await requireDeveloper(authorization.actor))) {
    return { response: NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 }) };
  }
  return authorization;
}

/** Developer-only feedback inbox. Public visitors never read feedback directly. */
export async function GET(req: NextRequest) {
  const authorization = await authorizeDeveloper(req);
  if ("response" in authorization) return authorization.response;

  const { data, error } = await authorization.actor.service
    .from("feedback_submissions")
    .select("id, name, email, feedback_type, message, source_page, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("Feedback inbox load error:", error);
    return NextResponse.json({ ok: false, error: "Could not load feedback." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, feedback: data || [] });
}

export async function PATCH(req: NextRequest) {
  const authorization = await authorizeDeveloper(req);
  if ("response" in authorization) return authorization.response;

  let body: { id?: string; status?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 }); }
  if (!body.id || !body.status || !statuses.has(body.status)) {
    return NextResponse.json({ ok: false, error: "A feedback item and valid status are required." }, { status: 400 });
  }

  const { error } = await authorization.actor.service
    .from("feedback_submissions")
    .update({ status: body.status })
    .eq("id", body.id);
  if (error) {
    console.error("Feedback inbox update error:", error);
    return NextResponse.json({ ok: false, error: "Could not update feedback status." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
