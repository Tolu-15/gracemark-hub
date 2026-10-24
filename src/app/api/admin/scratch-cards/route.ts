import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { getCurrentSessionAndTerm } from "@/lib/financeServer";
import { isTermCode } from "@/lib/serverContext";
import { getCardSettings } from "@/lib/systemSettings";
import { generatePin, generateSerial, hashPin, isCardIssuer } from "@/lib/scratchCards";

const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

/**
 * GET   — every admin can see sales; `canIssue` says whether this admin may issue/revoke.
 * POST  — { student_id, term, source: "offline" | "complimentary", session_id?, amount_received? }
 *         issues a PIN card for one student. Only the named card issuers may do this.
 * PATCH — { card_id, reason? } revokes a card. Only the named card issuers may do this.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const sp = req.nextUrl.searchParams;
  let q = service
    .from("scratch_cards")
    .select(
      "id, serial, student_id, term_code, academic_session_id, views_allowed, views_used, source, status, payment_reference, amount_paid, issued_by_email, revoked_reason, activated_at, created_at, students(name, admission_no), academic_sessions(name)"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (sp.get("session_id")) q = q.eq("academic_session_id", sp.get("session_id")!);
  if (sp.get("term") && isTermCode(sp.get("term"))) q = q.eq("term_code", sp.get("term")!);
  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const cards = (data || []).map((c: any) => ({
    id: c.id,
    serial: c.serial,
    studentId: c.student_id,
    studentName: one(c.students)?.name || "",
    admissionNo: one(c.students)?.admission_no || "",
    session: one(c.academic_sessions)?.name || "",
    sessionId: c.academic_session_id,
    term: c.term_code,
    viewsAllowed: c.views_allowed,
    viewsUsed: c.views_used,
    source: c.source,
    status: c.status,
    paymentReference: c.payment_reference,
    amountPaid: Number(c.amount_paid || 0),
    issuedBy: c.issued_by_email,
    revokedReason: c.revoked_reason,
    activatedAt: c.activated_at,
    createdAt: c.created_at,
  }));

  // Revenue only counts money actually received (online + offline); complimentary cards are free.
  const revenue = new Map<string, { session: string; term: string; online: number; offline: number; complimentary: number; revenue: number }>();
  cards
    .filter((c) => c.status !== "revoked")
    .forEach((c) => {
      const key = `${c.session}|${c.term}`;
      const row = revenue.get(key) || { session: c.session, term: c.term, online: 0, offline: 0, complimentary: 0, revenue: 0 };
      row[c.source as "online" | "offline" | "complimentary"] += 1;
      row.revenue += c.amountPaid;
      revenue.set(key, row);
    });

  // Payments that succeeded but need a human: the student already held a card (refund/credit),
  // or the order has sat unconfirmed for over an hour.
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { data: purchases } = await service
    .from("scratch_card_purchases")
    .select("reference, status, amount, created_at, students(name, admission_no)")
    .or(`status.eq.duplicate,and(status.eq.pending,created_at.lt.${hourAgo})`)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    ok: true,
    canIssue: isCardIssuer(actor),
    ...(await (async () => {
      const s = await getCardSettings(service);
      return { price: s.price, viewsAllowed: s.viewsAllowed };
    })()),
    cards,
    revenue: Array.from(revenue.values()),
    needsAttention: (purchases || []).map((p: any) => ({
      reference: p.reference,
      status: p.status,
      amount: Number(p.amount),
      createdAt: p.created_at,
      studentName: one(p.students)?.name || "",
      admissionNo: one(p.students)?.admission_no || "",
    })),
  });
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  if (!isCardIssuer(actor)) {
    return NextResponse.json({ ok: false, error: "Only the authorised card issuers can issue scratch cards." }, { status: 403 });
  }

  let body: { student_id?: string; term?: string; source?: string; session_id?: string; amount_received?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const { student_id: studentId, term, source } = body;
  if (!studentId || !isTermCode(term) || (source !== "offline" && source !== "complimentary")) {
    return NextResponse.json({ ok: false, error: "student_id, a valid term and source (offline or complimentary) are required." }, { status: 400 });
  }

  const sessionId = body.session_id || (await getCurrentSessionAndTerm(service)).sessionId;
  if (!sessionId) return NextResponse.json({ ok: false, error: "No current session is set." }, { status: 400 });

  const { data: student } = await service.from("students").select("id, name, admission_no").eq("id", studentId).maybeSingle();
  if (!student) return NextResponse.json({ ok: false, error: "Student not found." }, { status: 404 });
  const { data: enrollment } = await service
    .from("student_enrollments")
    .select("id, academic_sessions(name)")
    .eq("student_id", studentId)
    .eq("academic_session_id", sessionId)
    .maybeSingle();
  if (!enrollment) return NextResponse.json({ ok: false, error: "This student is not enrolled in that session." }, { status: 400 });

  // Offline cards record the cash received (the card price unless the admin enters otherwise).
  const cardSettings = await getCardSettings(service);
  const amountPaid = source === "complimentary" ? 0 : Number(body.amount_received ?? cardSettings.price);
  if (!Number.isFinite(amountPaid) || amountPaid < 0) {
    return NextResponse.json({ ok: false, error: "Amount received is not valid." }, { status: 400 });
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const pin = generatePin();
    const { data: card, error } = await service
      .from("scratch_cards")
      .insert({
        serial: generateSerial(),
        pin_hash: hashPin(pin),
        student_id: studentId,
        academic_session_id: sessionId,
        term_code: term,
        views_allowed: cardSettings.viewsAllowed,
        source,
        status: "issued",
        amount_paid: amountPaid,
        issued_by_user_id: actor.dbUserId ?? null,
        issued_by_email: actor.email ?? null,
      })
      .select("id, serial")
      .single();

    if (!error && card) {
      const sessionName = one((enrollment as any).academic_sessions as any)?.name as string | undefined;
      await logAudit(actor, {
        action: source === "complimentary" ? "scratch_card.issue_free" : "scratch_card.issue_offline",
        entityType: "scratch_card",
        entityId: card.id,
        summary: `Issued ${source} scratch card ${card.serial} to ${student.name} (${term}, ${sessionName || "session"})${source === "offline" ? `, ₦${amountPaid} received` : ""}`,
        metadata: { student_id: studentId, term, session_id: sessionId, amount_received: amountPaid },
      });
      // The PIN is only ever shown here: it is stored hashed and can't be recovered later.
      return NextResponse.json({
        ok: true,
        pin,
        card: { id: card.id, serial: card.serial, term, session: sessionName || "", studentName: student.name, admissionNo: student.admission_no, source },
      });
    }

    if ((error as any)?.code === "23505") {
      const msg = String(error?.message || "");
      // The open-card index: this student already holds a card for this term.
      if (msg.includes("uq_scratch_card_open")) {
        return NextResponse.json({ ok: false, error: "This student already has an unused card for that term. Revoke it first if it should be replaced." }, { status: 409 });
      }
      continue; // a serial or PIN collision: try again with new random values
    }
    return NextResponse.json({ ok: false, error: error?.message || "Could not issue the card." }, { status: 500 });
  }
  return NextResponse.json({ ok: false, error: "Could not generate a unique card. Please try again." }, { status: 500 });
}

export async function PATCH(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;
  if (!isCardIssuer(actor)) {
    return NextResponse.json({ ok: false, error: "Only the authorised card issuers can revoke scratch cards." }, { status: 403 });
  }

  let body: { card_id?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.card_id) return NextResponse.json({ ok: false, error: "card_id is required." }, { status: 400 });
  const reason = String(body.reason || "").trim();

  const { data: updated, error } = await service
    .from("scratch_cards")
    .update({ status: "revoked", revoked_reason: reason || null, updated_at: new Date().toISOString() })
    .eq("id", body.card_id)
    .in("status", ["issued", "active"])
    .select("id, serial");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!updated?.length) return NextResponse.json({ ok: false, error: "That card is already used up or revoked." }, { status: 409 });

  await logAudit(actor, {
    action: "scratch_card.revoke",
    entityType: "scratch_card",
    entityId: body.card_id,
    summary: `Revoked scratch card ${updated[0].serial}${reason ? `: ${reason}` : ""}`,
    metadata: { reason },
  });
  return NextResponse.json({ ok: true });
}
