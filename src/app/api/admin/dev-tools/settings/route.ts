import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { getCardSettings, getMaintenance, parseCardSettings, parseMaintenance, saveSetting } from "@/lib/systemSettings";

/**
 * Developer-only app settings (Dev Tools -> App Settings).
 *   GET                          current scratch card and maintenance settings
 *   PUT { section, value }       section "scratch_card" | "maintenance"; every change is audit-logged
 * Admins who are not the developer can see the card price in Scratch Cards but never change it.
 */
async function authorize(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization;
  if (!(await requireDeveloper(authorization.actor))) {
    return { response: NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 }) };
  }
  return authorization;
}

export async function GET(req: NextRequest) {
  const authorization = await authorize(req);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;
  const [card, maintenance] = await Promise.all([getCardSettings(service), getMaintenance(service)]);
  const { error: tableError } = await service.from("system_settings").select("key", { head: true, count: "exact" });
  return NextResponse.json({
    ok: true,
    card,
    maintenance,
    paystackConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY),
    // False until supabase/041_system_settings.sql has been applied: saving would fail.
    storeReady: !tableError,
  });
}

export async function PUT(req: NextRequest) {
  const authorization = await authorize(req);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service, dbUserId } = actor;

  const body = await req.json().catch(() => null);
  const section = String(body?.section || "");

  if (section === "scratch_card") {
    const parsed = parseCardSettings(body?.value);
    if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const before = await getCardSettings(service);
    const error = await saveSetting(service, "scratch_card", parsed.value, dbUserId);
    if (error) return NextResponse.json({ ok: false, error: `Could not save: ${error}. Has migration 041 been applied?` }, { status: 500 });
    const after = await getCardSettings(service);
    await logAudit(actor, {
      action: "dev_tools.settings_card",
      entityType: "system_settings",
      entityId: "scratch_card",
      summary: `Scratch card settings: price ₦${before.price} → ₦${after.price}, views ${before.viewsAllowed} → ${after.viewsAllowed}, online sales ${before.onlineEnabled ? "on" : "off"} → ${after.onlineEnabled ? "on" : "off"}`,
      metadata: { before, after },
    });
    return NextResponse.json({ ok: true, card: after });
  }

  if (section === "maintenance") {
    const parsed = parseMaintenance(body?.value);
    if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const before = await getMaintenance(service);
    const error = await saveSetting(service, "maintenance", parsed.value, dbUserId);
    if (error) return NextResponse.json({ ok: false, error: `Could not save: ${error}. Has migration 041 been applied?` }, { status: 500 });
    const after = await getMaintenance(service);
    await logAudit(actor, {
      action: after.enabled ? "dev_tools.maintenance_on" : "dev_tools.maintenance_off",
      entityType: "system_settings",
      entityId: "maintenance",
      summary: `Maintenance mode ${before.enabled ? "on" : "off"} → ${after.enabled ? "on" : "off"}${after.enabled && after.allowAdmins ? " (admins allowed)" : ""}`,
      metadata: { before, after },
    });
    return NextResponse.json({ ok: true, maintenance: after });
  }

  return NextResponse.json({ ok: false, error: "Unknown section." }, { status: 400 });
}
