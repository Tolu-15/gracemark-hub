import { createHash, randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiActor } from "@/lib/apiAuth";
import { getCardSettings } from "@/lib/systemSettings";
import {
  REF_PREFIX,
  newReference,
  verifyPaystackReference,
  type PaystackTransaction,
} from "@/lib/financeServer";

/**
 * Scratch cards for the Terminal Result (TR). One card = one student + one session + one term,
 * 5 successful views, printing included. See docs/SCRATCH_CARD_SPEC.md.
 * Everything here runs with the service-role client; browsers never touch these tables.
 */

// Price, views per card and the online-sales switch are developer settings: see getCardSettings()
// in src/lib/systemSettings.ts (Dev Tools -> App Settings).
/** Minutes after a charged view in which re-opening with the same card is free. 0 = every open counts. */
export const GRACE_MINUTES = 0;
export const MAX_FAILED_PINS = 5;
export const FAILED_PIN_WINDOW_MINUTES = 15;

const DEFAULT_ISSUER_EMAILS = ["toluwanimibabalola2707@gmail.com", "gracemarkacademy@gmail.com"];

/** Admins allowed to issue and revoke cards. Override with SCRATCH_CARD_ISSUER_EMAILS (comma separated). */
export function issuerEmails(): string[] {
  const fromEnv = (process.env.SCRATCH_CARD_ISSUER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ISSUER_EMAILS;
}

export const isCardIssuer = (actor: ApiActor) =>
  actor.role === "admin" && Boolean(actor.email) && issuerEmails().includes(actor.email!.toLowerCase());

/* ----------------------------- PINs ------------------------------------- */

// No 0/O/1/I/L so a PIN read off a printed slip can't be mistyped.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const randomChars = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** 12 random characters shown as XXXX-XXXX-XXXX (about 59 bits). */
export function generatePin(): string {
  const raw = randomChars(12);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export const normalizePin = (pin: string) => String(pin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const hashPin = (pin: string) =>
  createHash("sha256")
    .update(normalizePin(pin) + (process.env.SCRATCH_CARD_PIN_PEPPER || ""))
    .digest("hex");

export const generateSerial = () => `GMC-${randomChars(8)}`;

/* ----------------------------- State ------------------------------------ */

export interface CardState {
  id: string;
  serial: string;
  status: "issued" | "active" | "exhausted" | "revoked";
  source: "online" | "offline" | "complimentary";
  viewsAllowed: number;
  viewsUsed: number;
  viewsLeft: number;
}

const toState = (c: any): CardState => ({
  id: c.id,
  serial: c.serial,
  status: c.status,
  source: c.source,
  viewsAllowed: c.views_allowed,
  viewsUsed: c.views_used,
  viewsLeft: Math.max(0, c.views_allowed - c.views_used),
});

/**
 * The card the student should see for a session + term: an open (issued/active) card first,
 * otherwise the most recent exhausted one so the page can say "all views used". Revoked cards
 * are treated as "no card".
 */
export async function getCardState(
  service: SupabaseClient,
  studentId: string,
  sessionId: string,
  termCode: string
): Promise<CardState | null> {
  const { data } = await service
    .from("scratch_cards")
    .select("id, serial, status, source, views_allowed, views_used")
    .eq("student_id", studentId)
    .eq("academic_session_id", sessionId)
    .eq("term_code", termCode)
    .in("status", ["issued", "active", "exhausted"])
    .order("created_at", { ascending: false })
    .limit(10);
  const cards = data || [];
  const open = cards.find((c: any) => c.status === "active" || c.status === "issued");
  const chosen = open || cards.find((c: any) => c.status === "exhausted");
  return chosen ? toState(chosen) : null;
}

/** Whether `student` has a published TR for this enrollment + term, and the snapshot if so. */
export async function getPublishedTr(service: SupabaseClient, enrollmentId: string, termCode: string) {
  const { data } = await service
    .from("result_snapshots")
    .select("snapshot_data, published_at")
    .eq("enrollment_id", enrollmentId)
    .eq("term", termCode)
    .eq("report_type", "TR")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { ...(data.snapshot_data as object), publishedAt: data.published_at } : null;
}

/** The student's enrollment for a session name, with the session id the cards are keyed on. */
export async function findEnrollment(service: SupabaseClient, studentId: string, sessionName: string) {
  const { data } = await service
    .from("student_enrollments")
    .select("id, academic_session_id, academic_sessions(name)")
    .eq("student_id", studentId);
  const match = (data || []).find((e: any) => {
    const s = Array.isArray(e.academic_sessions) ? e.academic_sessions[0] : e.academic_sessions;
    return s?.name === sessionName;
  });
  return match ? { enrollmentId: match.id as string, sessionId: match.academic_session_id as string } : null;
}

/* ------------------------------ Views ----------------------------------- */

/**
 * Charges one view. The update only applies if the row still has the `views_used` we read, so two
 * simultaneous opens can never spend the same view or push a card past its allowance.
 * Returns null when the card can't be charged (not active, used up, or lost the race 4 times).
 */
export async function spendView(service: SupabaseClient, cardId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: card } = await service
      .from("scratch_cards")
      .select("id, status, views_used, views_allowed")
      .eq("id", cardId)
      .maybeSingle();
    if (!card || card.status !== "active" || card.views_used >= card.views_allowed) return null;

    const next = card.views_used + 1;
    const { data: updated } = await service
      .from("scratch_cards")
      .update({
        views_used: next,
        status: next >= card.views_allowed ? "exhausted" : "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", cardId)
      .eq("status", "active")
      .eq("views_used", card.views_used)
      .select("id");
    if (updated?.length) return { viewsUsed: next, viewsAllowed: card.views_allowed as number };
  }
  return null;
}

/** True when a charged view on this card by this account happened inside the grace window. */
export async function withinGrace(service: SupabaseClient, cardId: string, viewerAuthId: string) {
  if (GRACE_MINUTES <= 0) return false;
  const since = new Date(Date.now() - GRACE_MINUTES * 60_000).toISOString();
  const { data } = await service
    .from("scratch_card_views")
    .select("id")
    .eq("card_id", cardId)
    .eq("viewer_auth_id", viewerAuthId)
    .gte("created_at", since)
    .limit(1);
  return Boolean(data?.length);
}

/* ----------------------------- Payments --------------------------------- */

/**
 * Online card sales have their own switch (Dev Tools -> App Settings, falling back to the
 * SCRATCH_CARD_ONLINE_ENABLED env flag) so they can run while school-fee payments and the
 * fee-based portal lock (NEXT_PUBLIC_PAYMENTS_ENABLED) stay off. Also needs the Paystack secret key.
 */
export async function onlineCardSalesEnabled(service: SupabaseClient) {
  if (!process.env.PAYSTACK_SECRET_KEY) return false;
  return (await getCardSettings(service)).onlineEnabled;
}

/** Records the order at today's price. The order keeps that price even if the setting changes later. */
export async function createPurchase(
  service: SupabaseClient,
  p: { studentId: string; sessionId: string; termCode: string }
) {
  const reference = newReference(REF_PREFIX.card);
  const { price } = await getCardSettings(service);
  const { error } = await service.from("scratch_card_purchases").insert({
    reference,
    student_id: p.studentId,
    academic_session_id: p.sessionId,
    term_code: p.termCode,
    amount: price,
    status: "pending",
  });
  if (error) throw error;
  return { reference, amount: price };
}

/**
 * Turns a Paystack payment that Paystack itself confirmed into an active card. Safe to call any
 * number of times for the same reference (browser callback, webhook and recovery all do): the
 * purchase row and the unique payment_reference on the card make it idempotent.
 */
export async function applyCardPayment(
  service: SupabaseClient,
  txn: PaystackTransaction,
  expected?: { studentId?: string }
): Promise<{ ok: true; status: string } | { ok: false; status: number; error: string }> {
  const reference = txn.reference || "";
  if (!reference.startsWith(`${REF_PREFIX.card}-`)) {
    return { ok: false, status: 422, error: "This payment is not a scratch card payment." };
  }

  const { data: purchase } = await service.from("scratch_card_purchases").select("*").eq("reference", reference).maybeSingle();
  if (!purchase) return { ok: false, status: 404, error: "No scratch card order matches this payment." };
  if (expected?.studentId && purchase.student_id !== expected.studentId) {
    return { ok: false, status: 403, error: "This payment belongs to another student." };
  }
  if (purchase.status === "success" || purchase.status === "duplicate") return { ok: true, status: purchase.status };

  // Paystack must have charged exactly the card price.
  if (Number(txn.amount) !== Math.round(Number(purchase.amount) * 100)) {
    return { ok: false, status: 422, error: "The amount paid does not match the scratch card price." };
  }

  const { viewsAllowed } = await getCardSettings(service);
  const { data: card, error } = await service
    .from("scratch_cards")
    .insert({
      serial: generateSerial(),
      student_id: purchase.student_id,
      academic_session_id: purchase.academic_session_id,
      term_code: purchase.term_code,
      views_allowed: viewsAllowed,
      source: "online",
      status: "active",
      payment_reference: reference,
      amount_paid: purchase.amount,
      activated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    // 23505 on payment_reference: a concurrent request (e.g. the webhook) already created the card.
    const { data: existing } = await service.from("scratch_cards").select("id").eq("payment_reference", reference).maybeSingle();
    if (existing) {
      await service.from("scratch_card_purchases").update({ status: "success", card_id: existing.id, updated_at: new Date().toISOString() }).eq("reference", reference);
      return { ok: true, status: "success" };
    }
    // Otherwise the open-card index fired: the student already holds a card for this term (for
    // example the school issued one while the payment was in flight). Money was taken, so flag it
    // for the admin to refund or credit instead of silently losing it.
    if ((error as any).code === "23505") {
      await service.from("scratch_card_purchases").update({ status: "duplicate", updated_at: new Date().toISOString() }).eq("reference", reference);
      return { ok: true, status: "duplicate" };
    }
    throw error;
  }

  await service
    .from("scratch_card_purchases")
    .update({ status: "success", card_id: card.id, updated_at: new Date().toISOString() })
    .eq("reference", reference);
  return { ok: true, status: "success" };
}

/** Re-checks the student's unfinished checkouts with Paystack so a payment never goes missing. */
export async function recoverPendingPurchases(service: SupabaseClient, studentId: string) {
  if (!(await onlineCardSalesEnabled(service))) return;
  const olderThan = new Date(Date.now() - 30_000).toISOString();
  const { data } = await service
    .from("scratch_card_purchases")
    .select("reference")
    .eq("student_id", studentId)
    .eq("status", "pending")
    .lt("created_at", olderThan)
    .order("created_at", { ascending: false })
    .limit(3);
  for (const row of data || []) {
    try {
      const txn = await verifyPaystackReference(row.reference);
      if (txn) await applyCardPayment(service, txn, { studentId });
    } catch (err) {
      console.warn("Scratch card payment recovery failed:", row.reference, (err as Error)?.message);
    }
  }
}
