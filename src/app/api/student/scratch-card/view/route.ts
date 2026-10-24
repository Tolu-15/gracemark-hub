import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { findStudentForActor } from "@/lib/financeServer";
import { isTermCode } from "@/lib/serverContext";
import { findEnrollment, getCardState, getPublishedTr, spendView, withinGrace } from "@/lib/scratchCards";

/**
 * POST { session, term, confirm: true }
 * Opens the student's Terminal Result with a scratch card. This is the ONLY way a student gets the
 * TR: the report route withholds it and the database policy blocks direct reads.
 *
 * A view is charged only once the report is in hand and the card can be charged, so an unpublished
 * result, a missing card or a failed request never costs a view.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service, authId, dbUserId } = actor;

  let body: { session?: string; term?: string; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const session = String(body.session || "").trim();
  const term = String(body.term || "").trim();
  if (!session || !isTermCode(term)) {
    return NextResponse.json({ ok: false, error: "Session and term are required." }, { status: 400 });
  }
  if (body.confirm !== true) {
    return NextResponse.json({ ok: false, error: "Please confirm that you want to use a view." }, { status: 400 });
  }

  const student = await findStudentForActor(service, authId, dbUserId);
  if (!student) return NextResponse.json({ ok: false, error: "Student record not found." }, { status: 404 });

  const enrollment = await findEnrollment(service, student.id, session);
  const report = enrollment ? await getPublishedTr(service, enrollment.enrollmentId, term) : null;
  if (!enrollment || !report) {
    return NextResponse.json({ ok: false, error: "The terminal result has not been published yet." }, { status: 404 });
  }

  const card = await getCardState(service, student.id, enrollment.sessionId, term);
  if (!card || card.status !== "active") {
    return NextResponse.json(
      {
        ok: false,
        needsCard: true,
        card,
        error: card?.status === "exhausted" ? "All views on your scratch card have been used." : "A scratch card is required to view this result.",
      },
      { status: 402 }
    );
  }

  // Inside the grace window (off by default) a re-open is free.
  if (await withinGrace(service, card.id, authId)) {
    return NextResponse.json({ ok: true, report, card, charged: false });
  }

  const spent = await spendView(service, card.id);
  if (!spent) {
    const fresh = await getCardState(service, student.id, enrollment.sessionId, term);
    return NextResponse.json(
      { ok: false, needsCard: true, card: fresh, error: "This scratch card can no longer be used." },
      { status: 402 }
    );
  }

  await service.from("scratch_card_views").insert({ card_id: card.id, viewer_auth_id: authId, views_used_after: spent.viewsUsed });
  await logAudit(actor, {
    action: "scratch_card.view",
    entityType: "scratch_card",
    entityId: card.id,
    summary: `Opened terminal result (${term}, ${session}) with card ${card.serial}: ${spent.viewsUsed}/${spent.viewsAllowed} views used`,
    metadata: { student_id: student.id, term, session, views_used: spent.viewsUsed },
  });

  const updated = { ...card, viewsUsed: spent.viewsUsed, viewsLeft: spent.viewsAllowed - spent.viewsUsed, status: spent.viewsUsed >= spent.viewsAllowed ? "exhausted" : "active" };
  return NextResponse.json({ ok: true, report, card: updated, charged: true });
}
