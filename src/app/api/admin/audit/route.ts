import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

/** GET ?page=1&action=student.&q=text&from=YYYY-MM-DD&to=YYYY-MM-DD — admin-only audit trail. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = 50;
  const action = (sp.get("action") || "").trim().replace(/[%_,()]/g, "");
  const q = (sp.get("q") || "").trim().replace(/[%,()]/g, " ");
  const from = sp.get("from");
  const to = sp.get("to");

  let query = service
    .from("audit_logs")
    .select("id, created_at, actor_email, actor_role, action, entity_type, entity_id, summary, metadata", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (action) query = query.like("action", `${action}%`);
  if (q) query = query.or(`summary.ilike.%${q}%,actor_email.ilike.%${q}%`);
  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, logs: data || [], total: count ?? 0, page, pageSize });
}
