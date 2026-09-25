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

    // Use provided password or default to standard 'gracemark'
    const tempPassword = String(body.password || body.tempPassword || "gracemark").trim() || "gracemark";

    const cleanAdm = (student.admission_no || "").trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const authEmail = `${cleanAdm}@student.gracemark.edu.ng`;

    let authUserId: string | null = null;
    let dbUserId: string | null = student.user_id;

    if (dbUserId) {
      // 1. Resolve auth_id from public.users
      const { data: uRow } = await service
        .from("users")
        .select("id, auth_id")
        .eq("id", dbUserId)
        .maybeSingle();

      if (uRow?.auth_id) {
        authUserId = uRow.auth_id;
      }
    }

    if (!authUserId) {
      // 2. Check public.users by student email
      const { data: uByEmail } = await service
        .from("users")
        .select("id, auth_id")
        .eq("email", authEmail)
        .maybeSingle();

      if (uByEmail?.auth_id) {
        authUserId = uByEmail.auth_id;
        dbUserId = uByEmail.id;
      }
    }

    // 3. If no auth user found, find or create in Supabase Auth
    if (!authUserId) {
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
    }

    // 4. Ensure public.users row exists and link to students.user_id
    const { data: dbUserRow } = await service
      .from("users")
      .upsert(
        {
          auth_id: authUserId,
          email: authEmail,
          display_name: student.name,
          role: "student",
          status: "active",
          must_change_password: false,
        },
        { onConflict: "auth_id" }
      )
      .select("id")
      .single();

    if (dbUserRow?.id && student.user_id !== dbUserRow.id) {
      await service.from("students").update({ user_id: dbUserRow.id }).eq("id", student.id);
    }

    // 5. Update password in Supabase Auth securely
    const { error: authErr } = await service.auth.admin.updateUserById(authUserId, {
      password: tempPassword,
      email_confirm: true,
    });

    if (authErr) {
      return NextResponse.json(
        { ok: false, error: "Auth password reset failed: " + authErr.message },
        { status: 500 }
      );
    }

    // 6. Set must_change_password = false on public.users
    await service
      .from("users")
      .update({ must_change_password: false })
      .eq("auth_id", authUserId);

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
