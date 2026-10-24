import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

const STATUSES = ["draft", "submitted", "approved", "returned"] as const;

/**
 * GET — how many score rows are in each status for the current term/session, for the dashboard's
 * term-progress widget.
 *
 * Each status is counted by the database (exact count, no rows downloaded). The previous version
 * downloaded every row and counted them here, but the API hands back at most 1,000 rows at a time,
 * so with more scores than that the Approved/Draft numbers came out short. Throwaway "ZZ Test"
 * classes from Dev Tools are left out so sample scores never inflate the school's real numbers.
 */
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

  const { data: testClasses } = await service.from("classes").select("id").like("name", "ZZ Test%");
  const testIds = (testClasses || []).map((c: any) => c.id);

  const countFor = async (status: (typeof STATUSES)[number]) => {
    let q = service.from("results").select("id", { count: "exact", head: true }).eq("term", term).eq("status", status);
    if (session) q = q.eq("session", session);
    if (testIds.length) q = q.not("class_id", "in", `(${testIds.join(",")})`);
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  };

  try {
    const [draft, submitted, approved, returned] = await Promise.all(STATUSES.map(countFor));
    const counts = { draft, submitted, approved, returned };
    return NextResponse.json({ ok: true, term, session, counts, total: draft + submitted + approved + returned });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Could not count scores." }, { status: 500 });
  }
}
