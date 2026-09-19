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
