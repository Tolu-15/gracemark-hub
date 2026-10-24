import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { setTermEditable } from "@/lib/termPermissions";

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const body = await req.json();
    const { session, term, allow_edit } = body || {};

    if (!session || !term) {
      return NextResponse.json(
        { error: "session and term are required." },
        { status: 400 }
      );
    }

    const boolAllow = Boolean(allow_edit);

    if (!service) {
      return NextResponse.json({ error: "Server service role not configured." }, { status: 503 });
    }

    const saveError = await setTermEditable(service, session, term, boolAllow);
    if (saveError) {
      return NextResponse.json({ error: saveError }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      session,
      term,
      allow_edit: boolAllow,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error." },
      { status: 500 }
    );
  }
}
