import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { MIGRATION_HINT } from "@/lib/subjectGroups";

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const [groupsRes, itemsRes, subjectsRes, classesRes] = await Promise.all([
    service.from("subject_groups").select("code, name, level, display_order").order("display_order"),
    service.from("subject_group_subjects").select("group_code, subject_id, credit_unit, display_order, frequency").order("display_order"),
    service.from("subjects").select("id, name, level").order("name"),
    service.from("classes").select("id, name, level, display_order, subject_group_code").order("display_order"),
  ]);

  const err = groupsRes.error || itemsRes.error || classesRes.error || subjectsRes.error;
  if (err) {
    const missing = /subject_group/i.test(err.message || "");
    return NextResponse.json({ ok: false, error: missing ? MIGRATION_HINT : err.message }, { status: missing ? 409 : 500 });
  }

  return NextResponse.json({
    ok: true,
    groups: groupsRes.data || [],
    items: itemsRes.data || [],
    subjects: subjectsRes.data || [],
    classes: classesRes.data || [],
  });
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (body?.action === "save-group") {
    const groupCode = String(body.group_code || "");
    const items: { subject_id: string; credit_unit: number; frequency?: string }[] = Array.isArray(body.items) ? body.items : [];
    if (!groupCode) return NextResponse.json({ ok: false, error: "group_code is required." }, { status: 400 });

    for (const item of items) {
      const unit = Number(item.credit_unit);
      if (!item.subject_id || !Number.isFinite(unit) || unit < 0 || unit > 20) {
        return NextResponse.json({ ok: false, error: "Credit units must be numbers between 0 and 20." }, { status: 400 });
      }
      if (item.frequency && !["weekly", "fortnightly"].includes(item.frequency)) {
        return NextResponse.json({ ok: false, error: "Frequency must be weekly or every 2 weeks." }, { status: 400 });
      }
    }
    const ids = items.map((i) => i.subject_id);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ ok: false, error: "A subject appears twice in the list." }, { status: 400 });
    }

    const { data: existing, error: exErr } = await service
      .from("subject_group_subjects")
      .select("id, subject_id")
      .eq("group_code", groupCode);
    if (exErr) return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 });

    const toRemove = (existing || []).filter((e: any) => !ids.includes(e.subject_id)).map((e: any) => e.id);
    if (toRemove.length) {
      const { error } = await service.from("subject_group_subjects").delete().in("id", toRemove);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (items.length) {
      const rows = items.map((item, index) => ({
        group_code: groupCode,
        subject_id: item.subject_id,
        credit_unit: Number(item.credit_unit),
        frequency: item.frequency === "weekly" ? "weekly" : "fortnightly",
        display_order: index + 1,
      }));
      const { error } = await service.from("subject_group_subjects").upsert(rows, { onConflict: "group_code,subject_id" });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  if (body?.action === "set-class-group") {
    const classId = String(body.class_id || "");
    const groupCode = body.group_code ? String(body.group_code) : null;
    if (!classId) return NextResponse.json({ ok: false, error: "class_id is required." }, { status: 400 });
    const { error } = await service.from("classes").update({ subject_group_code: groupCode }).eq("id", classId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
