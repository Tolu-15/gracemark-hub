import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";
import { getEmailTemplatePreviews } from "@/lib/email";

/** GET — every email template rendered with sample data, plus how many guardians still await a welcome. Read-only. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!(await requireDeveloper(actor))) return NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 });

  const { count } = await actor.service
    .from("students")
    .select("id", { count: "exact", head: true })
    .not("guardian_email", "is", null)
    .neq("guardian_email", "")
    .is("guardian_welcome_sent_at", null);

  return NextResponse.json({ ok: true, templates: getEmailTemplatePreviews(), pendingGuardianWelcomes: count ?? 0 });
}
