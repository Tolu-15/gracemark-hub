import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const studentId = body.student_id || body.studentId || body.id;
    const admissionNo = body.admission_no || body.admissionNo || body.admissionNumber;

    if (!studentId && !admissionNo) {
      return NextResponse.json(
        { ok: false, error: "Student ID or Admission Number is required." },
        { status: 400 }
      );
    }

    let query = service.from("students").select("id, name, admission_no, user_id").limit(1);
    if (studentId) query = query.eq("id", studentId);
    else if (admissionNo) query = query.eq("admission_no", admissionNo);

    const { data: student, error: stdErr } = await query.maybeSingle();
    if (stdErr || !student) {
      return NextResponse.json({ ok: false, error: "Student profile not found." }, { status: 404 });
    }

    // Generate random 5-digit pin, e.g. Gma@48291
    const randomDigits = Math.floor(10000 + Math.random() * 90000);
    const tempPassword = `Gma@${randomDigits}`;

    let authUserId = student.user_id;

    // If no user_id is linked yet, attempt to find or create one
    if (!authUserId) {
      const cleanAdm = (student.admission_no || "").trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const authEmail = `${cleanAdm}@student.gracemark.edu.ng`;

      // Check if user exists in auth
      const { data: userList } = await service.auth.admin.listUsers();
      const existingUser = userList?.users?.find(
        (u) => u.email?.toLowerCase() === authEmail.toLowerCase()
      );

      if (existingUser) {
        authUserId = existingUser.id;
      } else {
        const { data: newUser, error: createErr } = await service.auth.admin.createUser({
          email: authEmail,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { role: "student", name: student.name },
        });
        if (createErr) {
          throw new Error("Could not provision auth account: " + createErr.message);
        }
        authUserId = newUser.user.id;
      }

      // Link user_id on student record
      await service.from("students").update({ user_id: authUserId }).eq("id", student.id);
    }

    // Update password in Supabase Auth securely
    const { error: authErr } = await service.auth.admin.updateUserById(authUserId, {
      password: tempPassword,
    });

    if (authErr) {
      return NextResponse.json(
        { ok: false, error: "Auth password reset failed: " + authErr.message },
        { status: 500 }
      );
    }

    // Flag must_change_password = true on student record and users table
    await service
      .from("students")
      .update({ must_change_password: true })
      .eq("id", student.id);

    try {
      await service
        .from("users")
        .update({ must_change_password: true })
        .or(`auth_id.eq.${authUserId},id.eq.${authUserId}`);
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: true,
      studentName: student.name,
      admissionNo: student.admission_no,
      tempPassword,
      temporary_password: tempPassword,
      temporaryPassword: tempPassword,
      message: `Password reset successfully for ${student.name}.`,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
