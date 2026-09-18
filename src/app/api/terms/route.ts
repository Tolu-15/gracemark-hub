import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { isTermEditable } from "@/lib/termPermissions";

export async function GET(req: NextRequest) {
  const service = getServiceClient();
  const searchParams = req.nextUrl.searchParams;

  let settings: { current_term?: string; current_session?: string } | null = null;
  if (service) {
    const { data } = await service.from("app_settings").select("*").limit(1).maybeSingle();
    settings = data;
  }

  const currentTerm = settings?.current_term || "term1";
  const currentSession =
    searchParams.get("session") || settings?.current_session || "2025/2026";

  const termKeys = [
    { term: "term1", label: "1st Term" },
    { term: "term2", label: "2nd Term" },
    { term: "term3", label: "3rd Term" },
  ];

  const resultTerms = await Promise.all(
    termKeys.map(async ({ term, label }) => {
      const isCurrent = term === currentTerm;
      const canEdit = await isTermEditable(currentSession, term, service, currentTerm);
      return {
        term,
        label,
        is_current: isCurrent,
        allow_edit: canEdit,
        status: isCurrent ? "current" : canEdit ? "unlocked" : "locked",
      };
    })
  );

  return NextResponse.json({
    ok: true,
    current_term: currentTerm,
    current_session: currentSession,
    terms: resultTerms,
  });
}
