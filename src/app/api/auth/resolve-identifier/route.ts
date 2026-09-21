import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawId = String(body.identifier || "").trim();

    if (!rawId) {
      return NextResponse.json({ ok: false, email: null }, { status: 400 });
    }

    if (rawId.includes("@")) {
      return NextResponse.json({ ok: true, email: rawId.toLowerCase() });
    }

    const service = getServiceClient();
    if (!service) {
      return NextResponse.json({ ok: false, email: null }, { status: 503 });
    }

    const cleanRef = rawId.replace(/^PAY-/i, "").replace(/\s+/g, "").toUpperCase();
    const hyphenated = cleanRef.includes("-") ? cleanRef : cleanRef.replace(/^(GMT)(\d+)/i, "$1-$2");
    const unhyphenated = cleanRef.replace(/-/g, "");

    // 1. Check users table by staff_id, email, or phone
    try {
      const { data: staffUser } = await service
        .from("users")
        .select("email, staff_id, role")
        .or(`staff_id.ilike.${cleanRef},staff_id.ilike.${hyphenated},staff_id.ilike.${unhyphenated},phone.eq.${rawId}`)
        .limit(1)
        .maybeSingle();

      if (staffUser?.email) {
        return NextResponse.json({ ok: true, email: staffUser.email.toLowerCase() });
      }
    } catch (err) {
      console.warn("Resolve identifier users query error:", err);
    }

    // 2. Check students table by admission_no
    try {
      const { data: student } = await service
        .from("students")
        .select("user_id, admission_no, users(email)")
        .or(`admission_no.ilike.${cleanRef},admission_no.ilike.${rawId}`)
        .limit(1)
        .maybeSingle();

      const studentAny = student as any;
      if (studentAny?.users?.email) {
        return NextResponse.json({ ok: true, email: studentAny.users.email.toLowerCase() });
      }
    } catch (err) {
      console.warn("Resolve identifier students query error:", err);
    }

    // 3. Check admissions table by admission_number
    try {
      const { data: adm } = await service
        .from("admissions")
        .select("parent_guardian_email, admission_number, application_ref")
        .or(`admission_number.ilike.${cleanRef},application_ref.ilike.${cleanRef}`)
        .limit(1)
        .maybeSingle();

      if (adm?.parent_guardian_email) {
        return NextResponse.json({ ok: true, email: adm.parent_guardian_email.toLowerCase() });
      }
    } catch (err) {
      console.warn("Resolve identifier admissions query error:", err);
    }

    return NextResponse.json({ ok: false, email: null });
  } catch (err: any) {
    console.error("Resolve identifier error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
