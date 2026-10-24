import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

/** GET — how many result rows are in each status for the current term/session, for the dashboard's term-progress widget and the Approvals sidebar badge. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const { data: settings } = await service
    .from("app_settings")
    .select("current_term, current_session")
    .limit(1)
    .maybeSingle();
  const term = settings?.current_term || "term1";
  const session = settings?.current_session || "";

  let query = service.from("results").select("status").eq("term", term);
  if (session) query = query.eq("session", session);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const counts = { draft: 0, submitted: 0, approved: 0, returned: 0 };
  (data || []).forEach((r: any) => {
    if (r.status in counts) counts[r.status as keyof typeof counts]++;
  });

  return NextResponse.json({ ok: true, term, session, counts, total: data?.length || 0 });
}
