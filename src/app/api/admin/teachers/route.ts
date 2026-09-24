import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { sendTeacherWelcomeEmail } from "@/lib/email";

const GOOGLE_FORM_URL = "https://forms.gle/bhiJ4CUkXJbHRP5p6";

export async function GET(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  try {
    const { data: teachers, error: tErr } = await service
      .from("users")
      .select("*")
      .eq("role", "teacher")
      .order("display_name", { ascending: true });

    if (tErr) throw tErr;

    // Fetch active assignments count
    const [ctaRes, staRes] = await Promise.all([
      service
        .from("class_teacher_assignments")
        .select("teacher_user_id, session, class_id, classes(name)")
        .eq("status", "active"),
      service
        .from("subject_teacher_assignments")
        .select("teacher_user_id, session, class_id, subject_id, classes(name), subjects(name)")
        .eq("status", "active"),
    ]);

    const ctaMap = new Map<string, any[]>();
    (ctaRes.data || []).forEach((c: any) => {
      if (!ctaMap.has(c.teacher_user_id)) ctaMap.set(c.teacher_user_id, []);
      ctaMap.get(c.teacher_user_id)!.push(c);
    });

    const staMap = new Map<string, any[]>();
    (staRes.data || []).forEach((s: any) => {
      if (!staMap.has(s.teacher_user_id)) staMap.set(s.teacher_user_id, []);
      staMap.get(s.teacher_user_id)!.push(s);
    });

    const enriched = (teachers || []).map((t: any) => ({
      ...t,
      classAssignments: ctaMap.get(t.auth_id) || [],
      subjectAssignments: staMap.get(t.auth_id) || [],
    }));

    let maxNum = 0;
    (teachers || []).forEach((t: any) => {
      const match = String(t.staff_id || "").match(/(?:GMT|GMA-?T-?)(\d+)/i) || String(t.email || "").match(/gmt(\d+)/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    const nextStaffId = `GMT${String(maxNum + 1).padStart(3, "0")}`;

    return NextResponse.json({ ok: true, teachers: enriched, nextStaffId });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { name, staffId, email, password, mustChangePassword } = body;

    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Teacher full name is required." }, { status: 400 });
    }

    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return NextResponse.json({ ok: false, error: "A valid teacher email address is required." }, { status: 400 });
    }

    // Standardize or auto-generate GMT Staff ID based on highest existing count
    let cleanStaffId = String(staffId || "").trim().toUpperCase();
    if (!cleanStaffId) {
      const { data: allTeachers } = await service
        .from("users")
        .select("staff_id, email")
        .eq("role", "teacher");

      let maxNum = 0;
      (allTeachers || []).forEach((t: any) => {
        const match = String(t.staff_id || "").match(/(?:GMT|GMA-?T-?)(\d+)/i) || String(t.email || "").match(/gmt(\d+)/i);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) maxNum = n;
        }
      });
      cleanStaffId = `GMT${String(maxNum + 1).padStart(3, "0")}`;
    }

    const initialPassword = password?.trim() || "gracemark";

    // 1. Create or update user in Supabase Auth Admin using service role
    let authUserId: string | null = null;
    const { data: authData, error: authError } = await service.auth.admin.createUser({
      email: cleanEmail,
      password: initialPassword,
      email_confirm: true,
      user_metadata: {
        display_name: name.trim(),
        role: "teacher",
        staff_id: cleanStaffId,
      },
    });

    if (authError) {
      // If user already exists in auth, retrieve and update password
      if (/already|exists|registered/i.test(authError.message)) {
        const { data: listData } = await service.auth.admin.listUsers();
        const existing = listData?.users?.find(
          (u) => u.email?.toLowerCase() === cleanEmail
        );
        if (existing?.id) {
          authUserId = existing.id;
          await service.auth.admin.updateUserById(authUserId, {
            password: initialPassword,
          });
        } else {
          return NextResponse.json({ ok: false, error: authError.message }, { status: 400 });
        }
      } else {
        return NextResponse.json({ ok: false, error: authError.message }, { status: 400 });
      }
    } else {
      authUserId = authData?.user?.id || null;
    }

    if (!authUserId) {
      return NextResponse.json({ ok: false, error: "Failed to create teacher auth account." }, { status: 500 });
    }

    // 2. Upsert into public.users
    const { data: userRow, error: uErr } = await service
      .from("users")
      .upsert(
        {
          auth_id: authUserId,
          email: cleanEmail,
          display_name: name.trim(),
          staff_id: cleanStaffId,
          role: "teacher",
          status: "active",
          must_change_password: Boolean(mustChangePassword ?? true),
        },
        { onConflict: "auth_id" }
      )
      .select("*")
      .single();

    if (uErr) throw uErr;

    // 3. Dispatch welcome email with credentials and Google Form allocation link
    let emailSent = false;
    let emailError: string | null = null;
    try {
      await sendTeacherWelcomeEmail({
        toEmail: cleanEmail,
        name: name.trim(),
        staffId: cleanStaffId,
        password: initialPassword,
        formUrl: GOOGLE_FORM_URL,
      });
      emailSent = true;
    } catch (mailErr: any) {
      console.warn("[admin/teachers] Welcome email delivery warning:", mailErr.message);
      emailError = mailErr.message;
    }

    return NextResponse.json({
      ok: true,
      teacher: userRow,
      staff_id: cleanStaffId,
      emailSent,
      emailError,
      message: emailSent
        ? `Teacher ${name.trim()} (${cleanStaffId}) registered successfully! Welcome email with login details and subject allocation form sent to ${cleanEmail}.`
        : `Teacher ${name.trim()} (${cleanStaffId}) registered successfully. (Note: Email could not be delivered: ${emailError || "Check Brevo API key"})`,
    });
  } catch (err: any) {
    console.error("Register teacher error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Failed to register teacher." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { teacherId, authId, status, email, personal_email, phone, display_name } = body;

    const id = teacherId || authId;
    if (!id) {
      return NextResponse.json({ ok: false, error: "Teacher identifier required" }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    if (status !== undefined) updates.status = status;
    if (email !== undefined) updates.email = email.trim().toLowerCase();
    if (personal_email !== undefined) updates.personal_email = personal_email;
    if (phone !== undefined) updates.phone = phone;
    if (display_name !== undefined) updates.display_name = display_name;

    const { data, error } = await service
      .from("users")
      .update(updates)
      .or(`id.eq.${id},auth_id.eq.${id}`)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    // If teacher is marked as 'former', optionally end their active assignments
    if (status === "former" && authId) {
      const todayStr = new Date().toISOString().split("T")[0];
      await Promise.all([
        service
          .from("class_teacher_assignments")
          .update({ status: "ended", end_date: todayStr })
          .eq("teacher_user_id", authId)
          .eq("status", "active"),
        service
          .from("subject_teacher_assignments")
          .update({ status: "ended", end_date: todayStr })
          .eq("teacher_user_id", authId)
          .eq("status", "active"),
      ]);
    }

    return NextResponse.json({ ok: true, teacher: data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(req.url);
    let teacherId = searchParams.get("id") || searchParams.get("teacherId") || searchParams.get("authId");

    if (!teacherId) {
      const body = await req.json().catch(() => ({}));
      teacherId = body.teacherId || body.id || body.authId;
    }

    if (!teacherId) {
      return NextResponse.json({ ok: false, error: "Teacher ID or Auth ID is required." }, { status: 400 });
    }

    // 1. Fetch user record from public.users
    const { data: user, error: fetchErr } = await service
      .from("users")
      .select("id, auth_id, email, display_name, role")
      .or(`id.eq.${teacherId},auth_id.eq.${teacherId}`)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    if (!user) {
      return NextResponse.json({ ok: false, error: "Teacher not found in database." }, { status: 404 });
    }

    if (user.role === "admin") {
      return NextResponse.json({ ok: false, error: "Admin accounts cannot be deleted through the teacher manager." }, { status: 403 });
    }

    const name = user.display_name || user.email || "Teacher";
    const authId = user.auth_id;
    const userId = user.id;

    // 2. Clean up assignments and delegations
    const userIds = [userId, authId].filter(Boolean);
    for (const uid of userIds) {
      await Promise.all([
        service.from("class_teacher_assignments").delete().eq("teacher_user_id", uid),
        service.from("subject_teacher_assignments").delete().eq("teacher_user_id", uid),
        service.from("classes").update({ class_teacher_id: null }).eq("class_teacher_id", uid),
      ]);
    }

    // 3. Delete from public.users table
    const { error: delUserErr } = await service.from("users").delete().eq("id", userId);
    if (delUserErr) {
      console.error("Error deleting from public.users:", delUserErr);
      throw delUserErr;
    }

    // 4. Delete from Supabase Auth
    let authDeleted = false;
    let authError: string | null = null;
    if (authId) {
      const { error: delAuthErr } = await service.auth.admin.deleteUser(authId);
      if (delAuthErr) {
        console.warn(`Could not delete Supabase auth user (${authId}):`, delAuthErr.message);
        authError = delAuthErr.message;
      } else {
        authDeleted = true;
      }
    }

    return NextResponse.json({
      ok: true,
      authDeleted,
      authError,
      message: `Teacher ${name} permanently deleted from database and Supabase Auth.`,
    });
  } catch (err: any) {
    console.error("Delete teacher error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Failed to delete teacher." }, { status: 500 });
  }
}
