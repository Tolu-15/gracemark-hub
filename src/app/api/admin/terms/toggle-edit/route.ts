import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { setTermEditOverride } from "@/lib/termPermissions";

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
    setTermEditOverride(session, term, boolAllow);

    if (!service) {
      return NextResponse.json({ error: "Server service role not configured." }, { status: 503 });
    }

    let { error: upsertError } = await service.from("terms").upsert(
      {
        session,
        term,
        allow_teacher_edit: boolAllow,
        status: boolAllow ? "open" : "closed",
      },
      { onConflict: "session,term" }
    );

    if (upsertError && upsertError.code === "42703") {
      // allow_teacher_edit column doesn't exist in this environment — fall back to status only.
      ({ error: upsertError } = await service.from("terms").upsert(
        {
          session,
          term,
          status: boolAllow ? "open" : "closed",
        },
        { onConflict: "session,term" }
      ));
    }

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
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
