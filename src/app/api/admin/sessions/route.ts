import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const [sessionsRes, settingsRes] = await Promise.all([
      service.from("academic_sessions").select("*").order("name", { ascending: true }),
      service.from("app_settings").select("current_session, current_term").limit(1).maybeSingle(),
    ]);

    return NextResponse.json({
      ok: true,
      sessions: sessionsRes.data || [],
      current_session: settingsRes.data?.current_session || "",
      current_term: settingsRes.data?.current_term || "term1",
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const setAsCurrent = Boolean(body.set_as_current);

    if (!name) {
      return NextResponse.json({ ok: false, error: "Session name is required" }, { status: 400 });
    }

    if (setAsCurrent) {
      await service.from("academic_sessions").update({ is_current: false }).neq("name", name);
    }

    const { data: session, error } = await service
      .from("academic_sessions")
      .upsert(
        {
          name,
          status: "active",
          is_current: setAsCurrent,
        },
        { onConflict: "name" }
      )
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    if (setAsCurrent) {
      const { data: existing } = await service.from("app_settings").select("id").limit(1).maybeSingle();
      const id = existing?.id || 1;
      await service.from("app_settings").upsert({ id, current_session: name, current_session_id: session.id });
    }

    return NextResponse.json({ ok: true, session });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const body = await req.json();
    const deleteAll = Boolean(body.all);
    const sessionName = String(body.name || "").trim();

    if (deleteAll) {
      // Delete all sessions
      const { error } = await service.from("academic_sessions").delete().neq("name", "__none__");
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

      // Clear current_session in app_settings
      const { data: existing } = await service.from("app_settings").select("id").limit(1).maybeSingle();
      if (existing) {
        await service.from("app_settings").update({ current_session: "" }).eq("id", existing.id);
      }

      return NextResponse.json({ ok: true, message: "All sessions deleted" });
    }

    if (!sessionName) {
      return NextResponse.json({ ok: false, error: "Session name is required for deletion" }, { status: 400 });
    }

    const { error } = await service.from("academic_sessions").delete().eq("name", sessionName);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    // If current_session was deleted, reset it
    const { data: settings } = await service.from("app_settings").select("id, current_session").limit(1).maybeSingle();
    if (settings?.current_session === sessionName) {
      await service.from("app_settings").update({ current_session: "" }).eq("id", settings.id);
    }

    return NextResponse.json({ ok: true, message: `Session ${sessionName} deleted` });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
