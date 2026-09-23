import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

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

    return NextResponse.json({ ok: true, teachers: enriched });
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
    const { name, staffId, phone, password, mustChangePassword } = body;

    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Teacher full name is required." }, { status: 400 });
    }

    // Standardize or auto-generate GMT Staff ID
    let cleanStaffId = String(staffId || "").trim().toUpperCase();
    if (!cleanStaffId) {
      const { data: allTeachers } = await service
        .from("users")
        .select("staff_id")
        .eq("role", "teacher");

      let maxNum = 0;
      (allTeachers || []).forEach((t: any) => {
        const match = String(t.staff_id || "").match(/GMT-?(\d+)/i) || String(t.staff_id || "").match(/GMA-T-(\d+)/i);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) maxNum = n;
        }
      });
      cleanStaffId = `GMT${String(maxNum + 1).padStart(3, "0")}`;
    }

    const cleanNumber = cleanStaffId.replace(/[^A-Z0-9]/g, "").toLowerCase();
    const syntheticEmail = `${cleanNumber}@teacher.gracemark.edu.ng`;
    const initialPassword = password?.trim() || "gracemark";

    // 1. Create or update user in Supabase Auth Admin using service role
    let authUserId: string | null = null;
    const { data: authData, error: authError } = await service.auth.admin.createUser({
      email: syntheticEmail,
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
          (u) => u.email?.toLowerCase() === syntheticEmail.toLowerCase()
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
          email: syntheticEmail,
          display_name: name.trim(),
          staff_id: cleanStaffId,
          phone: phone?.trim() || null,
          role: "teacher",
          status: "active",
          must_change_password: Boolean(mustChangePassword),
        },
        { onConflict: "auth_id" }
      )
      .select("*")
      .single();

    if (uErr) throw uErr;

    return NextResponse.json({
      ok: true,
      teacher: userRow,
      staff_id: cleanStaffId,
      message: `Teacher registered successfully with ID ${cleanStaffId}`,
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
    const { teacherId, authId, status, personal_email, phone, display_name } = body;

    const id = teacherId || authId;
    if (!id) {
      return NextResponse.json({ ok: false, error: "Teacher identifier required" }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    if (status !== undefined) updates.status = status;
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
