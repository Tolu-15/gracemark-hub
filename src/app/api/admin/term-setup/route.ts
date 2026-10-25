import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { fetchAll } from "@/lib/fetchAll";

const TERMS = ["term1", "term2", "term3"] as const;
type Term = (typeof TERMS)[number];
const LABEL: Record<Term, string> = { term1: "1st Term", term2: "2nd Term", term3: "3rd Term" };
const nextTermOf = (t: string): Term | null => (t === "term1" ? "term2" : t === "term2" ? "term3" : null);

async function current(service: any) {
  const { data } = await service.from("app_settings").select("id, current_term, current_session, current_session_id").limit(1).maybeSingle();
  return {
    settingsId: data?.id as string | number | undefined,
    term: (TERMS as readonly string[]).includes(data?.current_term) ? (data.current_term as Term) : "term1",
    session: (data?.current_session as string) || "",
    sessionId: (data?.current_session_id as string) || "",
  };
}

/**
 * GET   Where the school is now and whether it is ready to move on: scores still in progress, classes
 *       whose Terminal Result is not published yet, and each term's teacher-edit lock.
 * POST  { school_days, next_term_begins?, acknowledge? } moves to the next term in the same session:
 *       saves the resumption date on the finishing term (printed on its report), the school days for
 *       the new term, locks the finished term for teachers and makes the new term current.
 *       Outstanding scores only warn; `acknowledge: true` is needed to proceed past them.
 * Changing session (after 3rd term) is a separate step: create the session, then run Promotions.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const cur = await current(service);
  if (!cur.sessionId) return NextResponse.json({ ok: false, error: "No current session is set. Set one on the dashboard first." }, { status: 400 });

  const [{ data: termRows }, { data: classes }, { data: testClasses }] = await Promise.all([
    service.from("academic_terms").select("term_code, status, school_days, next_term_begins, allow_teacher_edit").eq("academic_session_id", cur.sessionId),
    service.from("classes").select("id, name").order("display_order"),
    service.from("classes").select("id").like("name", "ZZ Test%"),
  ]);
  const testIds = (testClasses || []).map((c: any) => c.id);

  const countFor = async (status: string) => {
    let q = service.from("results").select("id", { count: "exact", head: true }).eq("term", cur.term).eq("session", cur.session).eq("status", status);
    if (testIds.length) q = q.not("class_id", "in", `(${testIds.join(",")})`);
    const { count } = await q;
    return count || 0;
  };
  const [draft, submitted, approved, returned] = await Promise.all(["draft", "submitted", "approved", "returned"].map(countFor));

  // Classes (with students) whose Terminal Result has not been published for the current term.
  const [enrollments, snapshots] = await Promise.all([
    fetchAll<{ id: string; class_id: string }>((from, to) =>
      service.from("student_enrollments").select("id, class_id").eq("academic_session_id", cur.sessionId).order("id").range(from, to) as any
    ),
    fetchAll<{ enrollment_id: string }>((from, to) =>
      service.from("result_snapshots").select("enrollment_id").eq("term", cur.term).eq("report_type", "TR").order("id").range(from, to) as any
    ),
  ]);
  const published = new Set(snapshots.map((s) => s.enrollment_id));
  const perClass = new Map<string, { students: number; published: number }>();
  enrollments.forEach((e) => {
    const row = perClass.get(e.class_id) || { students: 0, published: 0 };
    row.students++;
    if (published.has(e.id)) row.published++;
    perClass.set(e.class_id, row);
  });
  const unpublished = (classes || [])
    .filter((c: any) => !testIds.includes(c.id) && (perClass.get(c.id)?.students || 0) > 0 && (perClass.get(c.id)?.published || 0) === 0)
    .map((c: any) => c.name as string);

  const terms = TERMS.map((t) => {
    const row = (termRows || []).find((r: any) => r.term_code === t) as any;
    return { term: t, label: LABEL[t], schoolDays: row?.school_days ?? null, nextTermBegins: row?.next_term_begins ?? null, teachersCanEdit: Boolean(row?.allow_teacher_edit) };
  });
  const next = nextTermOf(cur.term);
  return NextResponse.json({
    ok: true,
    session: cur.session,
    term: cur.term,
    termLabel: LABEL[cur.term],
    next: next ? { term: next, label: LABEL[next] } : null,
    terms,
    scores: { draft, submitted, approved, returned },
    unpublishedClasses: unpublished,
  });
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const body = await req.json().catch(() => null);
  const cur = await current(service);
  const next = nextTermOf(cur.term);
  if (!cur.sessionId || cur.settingsId === undefined) return NextResponse.json({ ok: false, error: "No current session is set." }, { status: 400 });
  if (!next) {
    return NextResponse.json({ ok: false, error: "This is the last term of the session. Create the new session, then run Class Promotions." }, { status: 400 });
  }

  const days = Number(body?.school_days);
  if (!Number.isInteger(days) || days < 1 || days > 250) return NextResponse.json({ ok: false, error: "School days must be a whole number from 1 to 250." }, { status: 400 });
  const begins = body?.next_term_begins ? String(body.next_term_begins) : null;
  if (begins && Number.isNaN(Date.parse(begins))) return NextResponse.json({ ok: false, error: "The resumption date is not a valid date." }, { status: 400 });

  // Outstanding work warns rather than blocks, but must be acknowledged.
  const { count: open } = await service
    .from("results")
    .select("id", { count: "exact", head: true })
    .eq("term", cur.term)
    .eq("session", cur.session)
    .in("status", ["draft", "submitted", "returned"]);
  if ((open || 0) > 0 && body?.acknowledge !== true) {
    return NextResponse.json({ ok: false, needsAcknowledge: true, error: `${open} score(s) are still draft, submitted or returned. Confirm you want to move on anyway.` }, { status: 409 });
  }

  // Finishing term: keep its resumption date and lock it for teachers (admins can unlock it again).
  const finishing = await service
    .from("academic_terms")
    .upsert(
      { academic_session_id: cur.sessionId, term_code: cur.term, ...(begins ? { next_term_begins: begins } : {}), allow_teacher_edit: false },
      { onConflict: "academic_session_id,term_code" }
    );
  if (finishing.error) return NextResponse.json({ ok: false, error: finishing.error.message }, { status: 500 });

  const starting = await service
    .from("academic_terms")
    .upsert({ academic_session_id: cur.sessionId, term_code: next, school_days: days, status: "open" }, { onConflict: "academic_session_id,term_code" });
  if (starting.error) return NextResponse.json({ ok: false, error: starting.error.message }, { status: 500 });

  const { error: settingsErr } = await service.from("app_settings").update({ current_term: next, updated_at: new Date().toISOString() }).eq("id", cur.settingsId);
  if (settingsErr) return NextResponse.json({ ok: false, error: settingsErr.message }, { status: 500 });

  await logAudit(actor, {
    action: "term_setup.advance",
    entityType: "app_settings",
    summary: `Moved ${cur.session} from ${LABEL[cur.term]} to ${LABEL[next]} (${days} school days${begins ? `, resumption ${begins}` : ""})${(open || 0) > 0 ? `; ${open} score(s) were still open` : ""}`,
    metadata: { session: cur.session, from: cur.term, to: next, schoolDays: days, nextTermBegins: begins, openScores: open || 0 },
  });
  return NextResponse.json({ ok: true, term: next, label: LABEL[next] });
}
