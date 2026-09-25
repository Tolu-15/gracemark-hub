import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  try {
    const { data, error } = await service
      .from("app_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    let sessionName = data?.current_session || "";
    if (!sessionName && data?.current_session_id) {
      const { data: sess } = await service
        .from("academic_sessions")
        .select("name")
        .eq("id", data.current_session_id)
        .maybeSingle();
      if (sess?.name) sessionName = sess.name;
    }

    if (!sessionName) {
      const { data: activeSess } = await service
        .from("academic_sessions")
        .select("name")
        .eq("status", "active")
        .maybeSingle();
      if (activeSess?.name) sessionName = activeSess.name;
    }

    return NextResponse.json({
      ok: true,
      settings: {
        ...(data || { id: 1, current_term: "term1" }),
        current_session: sessionName,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const current_term = String(body.current_term || "term1").trim();
    const current_session = String(body.current_session || "").trim();

    // 1. Fetch or create existing app_settings
    const { data: existing } = await service
      .from("app_settings")
      .select("id")
      .limit(1)
      .maybeSingle();

    const id = existing?.id || 1;

    // Resolve academic_session_id
    let current_session_id: string | null = null;
    if (current_session) {
      const { data: sessRow } = await service
        .from("academic_sessions")
        .select("id")
        .eq("name", current_session)
        .maybeSingle();
      if (sessRow?.id) {
        current_session_id = sessRow.id;
        await service.from("academic_sessions").update({ status: "inactive", is_current: false }).neq("id", current_session_id);
        await service.from("academic_sessions").update({ status: "active", is_current: true }).eq("id", current_session_id);
      }
    }

    const payload: any = {
      id,
      current_term,
      current_session,
      updated_at: new Date().toISOString(),
    };
    if (current_session_id) {
      payload.current_session_id = current_session_id;
    }

    const { data: updatedSettings, error: updateError } = await service
      .from("app_settings")
      .upsert(payload)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 400 });
    }

    // 2. Keep terms table in sync: set current term open and editable
    if (current_session) {
      await service.from("terms").upsert(
        {
          session: current_session,
          term: current_term,
          allow_teacher_edit: true,
          status: "open",
        },
        { onConflict: "session,term" }
      );
    }

    return NextResponse.json({
      ok: true,
      settings: {
        ...updatedSettings,
        current_session,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
