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
        .select("id, user_id, admission_no, full_name")
        .or(`admission_no.ilike.${cleanRef},admission_no.ilike.${rawId}`)
        .limit(1)
        .maybeSingle();

      if (student) {
        const cleanAdm = (student.admission_no || "").replace(/[^A-Z0-9]/gi, "").toLowerCase();
        let targetEmail = `${cleanAdm}@student.gracemark.edu.ng`;

        // Check if student has a linked email in public.users
        if (student.user_id) {
          const { data: userProfile } = await service
            .from("users")
            .select("email, auth_id, id")
            .or(`auth_id.eq.${student.user_id},id.eq.${student.user_id}`)
            .limit(1)
            .maybeSingle();

          if (userProfile?.email) {
            targetEmail = userProfile.email.toLowerCase();
          }
        }

        // Self-healing: verify this student has a valid Supabase Auth user, or provision one with default password 'gracemark'
        try {
          const { data: listData } = await service.auth.admin.listUsers();
          let existingAuthUser = listData?.users?.find(
            (u) => u.email?.toLowerCase() === targetEmail.toLowerCase()
          );

          if (!existingAuthUser) {
            // Provision user with default password 'gracemark'
            const { data: createdAuth } = await service.auth.admin.createUser({
              email: targetEmail,
              password: "gracemark",
              email_confirm: true,
              user_metadata: {
                display_name: student.full_name || "Student",
                role: "student",
              },
            });
            if (createdAuth?.user) {
              existingAuthUser = createdAuth.user;
            }
          }

          if (existingAuthUser) {
            // Ensure public.users profile exists
            const { data: upUser } = await service
              .from("users")
              .upsert(
                {
                  auth_id: existingAuthUser.id,
                  email: targetEmail,
                  display_name: student.full_name || "Student",
                  role: "student",
                  status: "active",
                  must_change_password: false,
                },
                { onConflict: "auth_id" }
              )
              .select("id")
              .single();

            // Ensure student.user_id points to public.users(id)
            if (upUser?.id && student.user_id !== upUser.id) {
              await service
                .from("students")
                .update({ user_id: upUser.id })
                .eq("id", student.id);
            }
          }
        } catch (provErr) {
          console.warn("Auto-provision auth check error:", provErr);
        }

        return NextResponse.json({ ok: true, email: targetEmail });
      }
    } catch (err) {
      console.warn("Resolve identifier student query error:", err);
    }

    // 3. Fallback: check admissions table by admission_number
    try {
      const { data: adm } = await service
        .from("admissions")
        .select("parent_guardian_email, admission_number")
        .or(`admission_number.ilike.${cleanRef},admission_number.ilike.${rawId}`)
        .limit(1)
        .maybeSingle();

      if (adm?.parent_guardian_email) {
        return NextResponse.json({ ok: true, email: adm.parent_guardian_email.toLowerCase() });
      }
    } catch (err) {
      console.warn("Resolve identifier admissions query error:", err);
    }

    // 4. Default algorithmic email mapping for student admission number formats
    if (/^[A-Z]{3,4}\d{4,8}$/i.test(cleanRef)) {
      return NextResponse.json({ ok: true, email: `${cleanRef.toLowerCase()}@student.gracemark.edu.ng` });
    }

    return NextResponse.json({ ok: false, email: null }, { status: 404 });
  } catch (err: any) {
    console.error("Resolve identifier route error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
