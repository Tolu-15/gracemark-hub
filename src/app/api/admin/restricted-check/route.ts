import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, isRestrictedAdmin } from "@/lib/apiAuth";

/** GET — whether the signed-in admin is a view-only account. Used to trim the nav down to read-only pages. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const restricted = await isRestrictedAdmin(authorization.actor);
  return NextResponse.json({ ok: true, restricted });
}
