import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { getLatestPrincipalSignature } from "@/lib/reportBuilder";

async function currentSession(service: any) {
  const { data: settings } = await service.from("app_settings").select("current_session, current_term").limit(1).maybeSingle();
  const session = settings?.current_session || "";
  const { data: sess } = session
    ? await service.from("academic_sessions").select("id").eq("name", session).maybeSingle()
    : { data: null };
  return { session, sessionId: sess?.id || null, currentTerm: settings?.current_term || "term1" };
}

/** GET ?term= → next term resumption date for the term, and the principal's signature. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const { session, sessionId, currentTerm } = await currentSession(service);
  const term = req.nextUrl.searchParams.get("term") || currentTerm;
  const { data: termRow } = sessionId
    ? await service.from("academic_terms").select("next_term_begins").eq("academic_session_id", sessionId).eq("term_code", term).maybeSingle()
    : { data: null };

  return NextResponse.json({
    ok: true,
    session,
    term,
    nextTermBegins: termRow?.next_term_begins || null,
    signature: await getLatestPrincipalSignature(service),
  });
}

/** POST { term, next_term_begins } or { signature: "data:image/...;base64,..." } */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service, dbUserId } = authorization.actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body?.signature === "string") {
    const sig: string = body.signature;
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(sig)) {
      return NextResponse.json({ ok: false, error: "Upload a PNG, JPG or WEBP image." }, { status: 400 });
    }
    if (sig.length > 700_000) {
      return NextResponse.json({ ok: false, error: "The image is too large. Use one under 500 KB." }, { status: 400 });
    }
    if (!dbUserId) return NextResponse.json({ ok: false, error: "Your admin account has no user profile." }, { status: 400 });

    await service.from("signatures").update({ is_active: false }).eq("signer_role", "principal").eq("is_active", true);
    const { error } = await service
      .from("signatures")
      .insert({ user_id: dbUserId, signer_role: "principal", signature_image_url: sig, is_active: true });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if ("next_term_begins" in (body || {})) {
    const { sessionId } = await currentSession(service);
    if (!sessionId) return NextResponse.json({ ok: false, error: "No current session is set." }, { status: 400 });
    const term = String(body.term || "");
    if (!["term1", "term2", "term3"].includes(term)) {
      return NextResponse.json({ ok: false, error: "A valid term is required." }, { status: 400 });
    }
    const date = body.next_term_begins ? String(body.next_term_begins) : null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, error: "Use a valid date." }, { status: 400 });
    }

    const { data: existing } = await service
      .from("academic_terms")
      .select("id")
      .eq("academic_session_id", sessionId)
      .eq("term_code", term)
      .maybeSingle();
    const { error } = existing
      ? await service.from("academic_terms").update({ next_term_begins: date }).eq("id", existing.id)
      : await service.from("academic_terms").insert({ academic_session_id: sessionId, term_code: term, next_term_begins: date });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
}
