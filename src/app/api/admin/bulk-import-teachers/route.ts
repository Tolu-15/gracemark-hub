import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

async function verifyAdminAccessToken(accessToken: string) {
  const service = getServiceClient();
  if (!service) return null;

  const { data: userData, error: userError } = await service.auth.getUser(accessToken);
  if (userError || !userData?.user?.id) return null;

  const { data: profile, error: profileError } = await service
    .from("users")
    .select("role")
    .eq("auth_id", userData.user.id)
    .maybeSingle();

  if (profileError || profile?.role !== "admin") return null;

  return userData.user;
}

export async function POST(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json(
      {
        error:
          "Admin service client is not configured. Add SUPABASE_SERVICE_ROLE_KEY to environment.",
      },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing admin access token." }, { status: 401 });
  }

  const adminUser = await verifyAdminAccessToken(token);
  if (!adminUser) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const teachers = body.teachers;
  if (!Array.isArray(teachers) || teachers.length === 0) {
    return NextResponse.json(
      { error: "Expected non-empty 'teachers' array." },
      { status: 400 }
    );
  }

  // Fetch all classes and subjects for mapping
  const [{ data: allClasses }, { data: allSubjects }] = await Promise.all([
    service.from("classes").select("id, name"),
    service.from("subjects").select("id, name"),
  ]);

  const normalizeStr = (str: string) =>
    str
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/\s+/g, "")
      .replace(/^ss([123])/, "sss$1")
      .replace(/^js([123])/, "jss$1");

  const classMap = new Map<string, string>();
  (allClasses || []).forEach((c) => {
    classMap.set(c.name.trim().toLowerCase(), c.id);
    classMap.set(normalizeStr(c.name), c.id);
  });

  const subjectMap = new Map<string, string>();
  (allSubjects || []).forEach((s) => {
    subjectMap.set(s.name.trim().toLowerCase(), s.id);
    subjectMap.set(normalizeStr(s.name), s.id);
  });

  const results: any[] = [];
  const errors: string[] = [];

  for (let i = 0; i < teachers.length; i++) {
    const t = teachers[i];
    const name = String(t.name || "").trim();
    const email = String(t.email || "").trim().toLowerCase();
    const password = String(t.password || "gracemark2026!").trim();
    const rawClasses: string[] = Array.isArray(t.classes)
      ? t.classes
      : String(t.classes || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    const rawSubjects: string[] = Array.isArray(t.subjects)
      ? t.subjects
      : String(t.subjects || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

    if (!name || !email) {
      errors.push(`Row ${i + 1}: Name and Email are required.`);
      continue;
    }

    try {
      // 1. Check or create Auth user
      let authUserId: string | null = null;
      const { data: createData, error: createError } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (createError) {
        // If already registered, find existing user id
        if (/already|exists|registered/i.test(createError.message)) {
          // Look up user in auth or public.users
          const { data: existingPublicUser } = await service
            .from("users")
            .select("auth_id")
            .eq("email", email)
            .maybeSingle();

          if (existingPublicUser?.auth_id) {
            authUserId = existingPublicUser.auth_id;
          } else {
            // Search auth users page
            const { data: authList } = await service.auth.admin.listUsers();
            const matched = authList?.users?.find(
              (u) => u.email?.toLowerCase() === email.toLowerCase()
            );
            if (matched) authUserId = matched.id;
          }
        } else {
          throw createError;
        }
      } else {
        authUserId = createData.user.id;
      }

      if (!authUserId) {
        // Fallback: generate a random uuid for teacher record
        authUserId = crypto.randomUUID();
      }

      // 2. Upsert in public.users
      const { data: userRow, error: uErr } = await service
        .from("users")
        .upsert(
          {
            auth_id: authUserId,
            email,
            display_name: name,
            role: "teacher",
          },
          { onConflict: "auth_id" }
        )
        .select()
        .single();

      if (uErr) throw uErr;

      // 3. Resolve class IDs
      const matchedClassIds: string[] = [];
      for (const rc of rawClasses) {
        const id = classMap.get(rc.toLowerCase()) || classMap.get(normalizeStr(rc));
        if (id && !matchedClassIds.includes(id)) {
          matchedClassIds.push(id);
        }
      }

      // 4. Resolve subject IDs (and auto-create subject if it does not exist!)
      const matchedSubjectIds: string[] = [];
      for (const rs of rawSubjects) {
        let sId = subjectMap.get(rs.toLowerCase()) || subjectMap.get(normalizeStr(rs));
        if (!sId && rs.trim()) {
          // Auto-insert newly discovered subject into subjects table!
          const { data: newSubj } = await service
            .from("subjects")
            .insert([{ name: rs.trim() }])
            .select()
            .maybeSingle();
          if (newSubj?.id) {
            const createdId: string = newSubj.id;
            sId = createdId;
            subjectMap.set(rs.trim().toLowerCase(), createdId);
            subjectMap.set(normalizeStr(rs.trim()), createdId);
          }
        }
        if (sId && !matchedSubjectIds.includes(sId)) {
          matchedSubjectIds.push(sId);
        }
      }

      // 5. Update teacher assignments
      await service.from("teacher_assignments").delete().eq("teacher_user_id", authUserId);

      const assignmentsToInsert: any[] = [];
      if (matchedClassIds.length > 0) {
        for (const cId of matchedClassIds) {
          if (matchedSubjectIds.length > 0) {
            for (const sId of matchedSubjectIds) {
              assignmentsToInsert.push({
                teacher_user_id: authUserId,
                class_id: cId,
                subject_id: sId,
              });
            }
          } else {
            assignmentsToInsert.push({
              teacher_user_id: authUserId,
              class_id: cId,
            });
          }
        }
      } else if (matchedSubjectIds.length > 0) {
        for (const sId of matchedSubjectIds) {
          assignmentsToInsert.push({
            teacher_user_id: authUserId,
            subject_id: sId,
          });
        }
      }

      if (assignmentsToInsert.length > 0) {
        await service.from("teacher_assignments").insert(assignmentsToInsert);
      }

      results.push({
        name,
        email,
        assignedClassesCount: matchedClassIds.length,
        assignedSubjectsCount: matchedSubjectIds.length,
      });
    } catch (err: any) {
      console.error(`Teacher import error for ${email}:`, err);
      errors.push(`"${name}" (${email}): ${err.message || "Failed to process."}`);
    }
  }

  return NextResponse.json({
    success: true,
    count: results.length,
    results,
    errors,
  });
}
