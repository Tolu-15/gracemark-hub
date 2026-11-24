import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { getCurrentSessionAndTerm } from "@/lib/financeServer";
import { isTermCode } from "@/lib/serverContext";
import { getCardSettings } from "@/lib/systemSettings";
import { generatePin, generateSerial, hashPin, isCardIssuer, getCardState } from "@/lib/scratchCards";

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
  const page = Number(sp.get("page") || 1);
  const pageSize = 40;
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) {
    return NextResponse.json({ error: "Invalid page." }, { status: 400 });
  }
  const search = (sp.get("q") || "").trim().slice(0, 120);
  let history = service.from("scratch_card_history").select("*", { count: "exact" })
    .order("created_at", { ascending: false }).order("entry_id").range((page - 1) * pageSize, page * pageSize - 1);
  let totals = service.from("scratch_card_sales_by_term").select("*").order("session").order("term");
  if (sp.get("session_id")) {
    history = history.eq("session_id", sp.get("session_id"));
    totals = totals.eq("session_id", sp.get("session_id"));
  }
  if (isTermCode(sp.get("term"))) {
    history = history.eq("term", sp.get("term"));
    totals = totals.eq("term", sp.get("term"));
  }
  if (sp.get("status") === "unissued") history = history.is("card_status", null);
  else if (sp.get("status") && sp.get("status") !== "all") history = history.eq("card_status", sp.get("status"));
  if (search) {
    // Quote each PostgREST value and escape LIKE metacharacters in names and references.
    const literal = search.replace(/[\\%_*]/g, character => "\\" + character);
    const pattern = JSON.stringify("%" + literal + "%");
    const filters = ["admission_no", "student_name", "serial", "reference"].map(column => column + ".ilike." + pattern);
    history = history.or(filters.join(","));
  }
  const [entries, sales] = await Promise.all([history, totals]);
  if (entries.error || sales.error) return NextResponse.json({ error: "Could not load scratch-card history." }, { status: 503 });
  const cards = (entries.data || []).map(row => ({
    id: row.card_id, entryId: row.entry_id, purchaseId: row.purchase_id, serial: row.serial,
    studentName: row.student_name, admissionNo: row.admission_no, session: row.session, sessionId: row.session_id,
    term: row.term, source: row.source, status: row.card_status || "unissued", paymentReference: row.reference,
    paymentStatus: row.payment_status, amount: Number(row.amount), amountPaid: Number(row.received),
    refunded: Number(row.refunded), issuedBy: row.issued_by_email, createdAt: row.created_at,
  }));

  // Payments that succeeded but need a human: the student already held a card (refund/credit),
  // or the order has sat unconfirmed for over an hour.
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { data: purchases } = await service
    .from("scratch_card_purchases")
    .select("reference, status, resolution, amount, refunded_amount, created_at, students(name, admission_no)")
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
    revenue: sales.data || [],
    total: entries.count || 0, pageSize,
    needsAttention: (purchases || []).filter(p => p.status !== "duplicate" || (!p.resolution && Number(p.refunded_amount) < Number(p.amount))).map((p: any) => ({
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

  const existing = await getCardState(service, studentId, sessionId, term);
  if (existing) return NextResponse.json({ ok: false, error: "This student already has a card for that term. Revoke it first if it should be replaced." }, { status: 409 });

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
    return NextResponse.json({ ok: false, error: "Only authorised card issuers can record refunds or revoke cards." }, { status: 403 });
  }

  let body: { card_id?: string; reason?: string; action?: string; entryId?: string; previous?: number; refunded?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (body.action === "record_refund") {
    const { previous, refunded, entryId } = body;
    if (!entryId || typeof previous !== "number" || typeof refunded !== "number" ||
        !Number.isFinite(refunded) || refunded <= previous || Math.abs(Math.round(refunded * 100) - refunded * 100) > 0.00001) {
      return NextResponse.json({ error: "Enter the total actually refunded, in naira." }, { status: 400 });
    }
    const { data: row, error } = await service.from("scratch_card_history").select("card_id,purchase_id,received,refunded")
      .eq("entry_id", entryId).maybeSingle();
    if (error) return NextResponse.json({ error: "Refund lookup failed." }, { status: 503 });
    if (!row || refunded > Number(row.received)) return NextResponse.json({ error: "Refund exceeds the received amount." }, { status: 400 });
    if (Number(row.refunded) === refunded) return NextResponse.json({ ok: true });
    const table = row.purchase_id ? "scratch_card_purchases" : "scratch_cards";
    const saved = await service.from(table).update({ refunded_amount: refunded })
      .eq("id", row.purchase_id || row.card_id).eq("refunded_amount", previous).select("id");
    if (saved.error) return NextResponse.json({ error: "Could not record refund." }, { status: 503 });
    if (!saved.data?.length) return NextResponse.json({ error: "Refund changed. Refresh the history and check it." }, { status: 409 });
    await logAudit(actor, { action: "scratch_card.refund_recorded", entityType: table, entityId: entryId,
      summary: "Recorded a completed scratch-card refund", metadata: { previous, refunded } });
    return NextResponse.json({ ok: true });
  }
  if (body.action && body.action !== "revoke") return NextResponse.json({ error: "Unknown card action." }, { status: 400 });
  if (!body.card_id) return NextResponse.json({ ok: false, error: "card_id is required." }, { status: 400 });
  const reason = String(body.reason || "").trim();

  const { data: updated, error } = await service
    .from("scratch_cards")
    .update({ status: "revoked", revoked_reason: reason || null, updated_at: new Date().toISOString() })
    .eq("id", body.card_id)
    .in("status", ["issued", "active", "exhausted"])
    .select("id, serial");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!updated?.length) return NextResponse.json({ ok: false, error: "That card is already revoked." }, { status: 409 });

  await logAudit(actor, {
    action: "scratch_card.revoke",
    entityType: "scratch_card",
    entityId: body.card_id,
    summary: `Revoked scratch card ${updated[0].serial}${reason ? `: ${reason}` : ""}`,
    metadata: { reason },
  });
  return NextResponse.json({ ok: true });
}
