import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { findStudentForActor } from "@/lib/financeServer";
import { isTermCode } from "@/lib/serverContext";
import { findEnrollment, getCardState, getPublishedTr, spendView } from "@/lib/scratchCards";

/**
 * POST { session, term }
 * Opens the student's Terminal Result with a scratch card. This is the ONLY way a student gets the
 * TR: the report route withholds it and the database policy blocks direct reads.
 *
 * Access is unlimited for the assigned student, session and term.
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
        error: "An active scratch card is required to view this result.",
      },
      { status: 402 }
    );
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
    summary: `Opened terminal result (${term}, ${session}) with card ${card.serial}: unlimited term access`,
    metadata: { student_id: student.id, term, session, views_used: spent.viewsUsed },
  });

  const updated = { ...card, viewsUsed: spent.viewsUsed, viewsLeft: spent.viewsAllowed - spent.viewsUsed, status: "active" };
  return NextResponse.json({ ok: true, report, card: updated, charged: false });
}
