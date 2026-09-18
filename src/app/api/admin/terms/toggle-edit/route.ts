import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { setTermEditOverride } from "@/lib/termsHelper";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { session, term, allow_edit } = body;
    if (!session || !term) {
      return NextResponse.json(
        { error: "session and term are required." },
        { status: 400 }
      );
    }

    const boolAllow = Boolean(allow_edit);
    setTermEditOverride(session, term, boolAllow);

    const service = getServiceClient();
    if (service) {
      try {
        await service.from("terms").upsert(
          {
            session,
            term,
            allow_teacher_edit: boolAllow,
            status: boolAllow ? "open" : "closed",
          },
          { onConflict: "session,term" }
        );
      } catch (_) {
        try {
          await service.from("terms").upsert(
            {
              session,
              term,
              status: boolAllow ? "open" : "closed",
            },
            { onConflict: "session,term" }
          );
        } catch (_) {}
      }
    }

    return NextResponse.json({ ok: true, session, term, allow_edit: boolAllow });
  } catch (err: any) {
    console.error("Toggle term edit error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
