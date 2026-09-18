import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { isTermEditable } from "@/lib/termPermissions";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const records = body.records || (Array.isArray(body) ? body : []);
  if (!records.length) {
    return NextResponse.json({ error: "No records provided." }, { status: 400 });
  }

  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ error: "Server service role not configured." }, { status: 503 });
  }

  // Check if term being saved is permitted for score editing
  const { data: settings } = await service
    .from("app_settings")
    .select("current_term, current_session")
    .limit(1)
    .maybeSingle();

  const currentTerm = settings?.current_term || "term1";

  for (const r of records) {
    const rTerm = r.term || currentTerm;
    const rSession = r.session || settings?.current_session || "2025/2026";
    const canEdit = await isTermEditable(rSession, rTerm, service, currentTerm);
    if (!canEdit) {
      return NextResponse.json(
        {
          error: `Editing scores for ${rTerm} is locked. Administration permission is required to edit non-current terms.`,
        },
        { status: 403 }
      );
    }
  }

  try {
    let { data, error } = await service
      .from("results")
      .upsert(records, { onConflict: "student_id,subject_id,term,session" });

    if (error && /submitted_at|return_reason/i.test(error.message || "")) {
      const cleaned = records.map(({ submitted_at, return_reason, ...rest }: any) => rest);
      ({ data, error } = await service
        .from("results")
        .upsert(cleaned, { onConflict: "student_id,subject_id,term,session" }));
    }

    if (error && /session|score_breakdown/i.test(error.message || "")) {
      const fallback = records.map(
        ({ session, class_id, score_breakdown, submitted_at, return_reason, ...rest }: any) => rest
      );
      ({ data, error } = await service
        .from("results")
        .upsert(fallback, { onConflict: "student_id,subject_id,term" }));
    }

    if (error) {
      console.error("Save results DB error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, count: records.length });
  } catch (err: any) {
    console.error("handleSaveResults exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to save results." },
      { status: 500 }
    );
  }
}
