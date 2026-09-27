import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

/** PUT { periods: [{ label, start_time, end_time, is_break }] } (admin) — replaces the school-day layout. */
export async function PUT(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const body = await req.json().catch(() => null);
  const list: any[] = Array.isArray(body?.periods) ? body.periods : [];
  if (!list.length || list.length > 20) {
    return NextResponse.json({ ok: false, error: "Provide between 1 and 20 periods." }, { status: 400 });
  }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  let prevEnd = "";
  const rows: any[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const label = String(p?.label || "").trim();
    const start = String(p?.start_time || "").slice(0, 5);
    const end = String(p?.end_time || "").slice(0, 5);
    if (!label || !time.test(start) || !time.test(end) || end <= start) {
      return NextResponse.json({ ok: false, error: `Row ${i + 1}: needs a name and an end time after the start time.` }, { status: 400 });
    }
    if (prevEnd && start < prevEnd) {
      return NextResponse.json({ ok: false, error: `Row ${i + 1} starts before the previous period ends.` }, { status: 400 });
    }
    prevEnd = end;
    rows.push({ id: typeof p.id === "string" && p.id ? p.id : undefined, position: i + 1, label, start_time: start, end_time: end, is_break: Boolean(p.is_break) });
  }

  // Keep existing ids so scheduled lessons stay attached; drop only periods that were removed.
  const keepIds = rows.map((r) => r.id).filter(Boolean) as string[];
  const { data: existing } = await service.from("timetable_periods").select("id");
  const removed = (existing || []).map((e: any) => e.id).filter((id: string) => !keepIds.includes(id));

  // Positions are unique: park them out of the way, then set the final layout.
  const { data: current } = await service.from("timetable_periods").select("id, position");
  for (const c of current || []) {
    await service.from("timetable_periods").update({ position: 1000 + (c as any).position }).eq("id", (c as any).id);
  }
  if (removed.length) await service.from("timetable_periods").delete().in("id", removed);
  for (const r of rows) {
    if (r.id) {
      const { id, ...rest } = r;
      const { error } = await service.from("timetable_periods").update(rest).eq("id", id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    } else {
      const { id: _drop, ...rest } = r;
      const { error } = await service.from("timetable_periods").insert(rest);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  await logAudit(actor, {
    action: "timetable.periods",
    entityType: "timetable",
    summary: `Updated the school-day periods (${rows.length} rows${removed.length ? `, ${removed.length} removed` : ""})`,
  });
  const { data: periods } = await service.from("timetable_periods").select("*").order("position");
  return NextResponse.json({ ok: true, periods: periods || [] });
}
