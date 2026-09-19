import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { studentId, admissionNo } = body;

    if (!studentId && !admissionNo) {
      return NextResponse.json({ ok: false, error: "Student ID or Admission Number is required." }, { status: 400 });
    }

    let query = service.from("students").select("id, name, admission_no, user_id").limit(1);
    if (studentId) query = query.eq("id", studentId);
    else if (admissionNo) query = query.eq("admission_no", admissionNo);

    const { data: student, error: stdErr } = await query.maybeSingle();
    if (stdErr || !student) {
      return NextResponse.json({ ok: false, error: "Student profile not found." }, { status: 404 });
    }

    if (!student.user_id) {
      return NextResponse.json({ ok: false, error: "Student has no associated auth user record." }, { status: 400 });
    }

    // Generate random 5-digit pin, e.g. Gma@48291
    const randomDigits = Math.floor(10000 + Math.random() * 90000);
    const tempPassword = `Gma@${randomDigits}`;

    // 1. Update password in Supabase Auth securely
    const { error: authErr } = await service.auth.admin.updateUserById(student.user_id, {
      password: tempPassword,
    });

    if (authErr) {
      return NextResponse.json({ ok: false, error: "Auth password reset failed: " + authErr.message }, { status: 500 });
    }

    // 2. Flag must_change_password = true on student record
    await service
      .from("students")
      .update({ must_change_password: true })
      .eq("id", student.id);

    return NextResponse.json({
      ok: true,
      studentName: student.name,
      admissionNo: student.admission_no,
      tempPassword,
      message: `Password reset successfully for ${student.name}.`,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
