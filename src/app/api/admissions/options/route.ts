import { PAYMENTS_ENABLED } from "@/lib/features";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getActiveAdmissionForm } from "@/lib/financeServer";

/** Public: the admission form on sale (name + price) and the classes an applicant can choose. */
export async function GET() {
  if (!PAYMENTS_ENABLED) return NextResponse.json({ ok: false, comingSoon: true, error: "Admissions are coming soon." });
  const service = getServiceClient();
  if (!service) return NextResponse.json({ ok: false, error: "Applications are temporarily unavailable." }, { status: 503 });

  try {
    const [form, classesRes] = await Promise.all([
      getActiveAdmissionForm(service),
      service.from("classes").select("id, name, display_order").order("display_order", { ascending: true }),
    ]);
    return NextResponse.json({
      ok: true,
      form: form ? { id: form.id, name: form.name, amount: Number(form.amount), description: form.description } : null,
      classes: (classesRes.data || []).map((c: any) => ({ id: c.id, name: c.name })),
    });
  } catch (err) {
    console.error("admissions options error:", err);
    return NextResponse.json({ ok: false, error: "Could not load admission options." }, { status: 500 });
  }
}
