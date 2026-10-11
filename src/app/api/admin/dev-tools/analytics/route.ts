import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";

/** GET ?days=30 — login trend, account activity, result views/prints and staff usage. Read-only. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!(await requireDeveloper(actor))) return NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 });

  const requested = Number(new URL(req.url).searchParams.get("days"));
  const days = [7, 30, 90].includes(requested) ? requested : 30;

  const { data, error } = await actor.service.rpc("dev_app_analytics", { p_days: days });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}
