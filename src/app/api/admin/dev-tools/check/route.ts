import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";

/** GET — whether the signed-in admin has Dev Tools access. Used to show/hide the nav item. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const isDeveloper = await requireDeveloper(authorization.actor);
  return NextResponse.json({ ok: true, isDeveloper });
}
