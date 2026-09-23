import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { STANDARD_JSS_SUBJECTS, getSSSTrackDefaults, isJuniorClass } from "@/lib/curriculum";

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service, authId } = authorization.actor;

  try {
    const body = await req.json();
    const {
      promotions = [], // Array of { studentId, studentName, fromClassId, toClassId, nextClassName, action: 'promote' | 'graduate' | 'repeat' }
      currentSession,
      currentSessionId,
      nextSession,
      nextSessionId,
      notes = "",
    } = body;

    if (!promotions.length) {
      return NextResponse.json({ ok: false, error: "No student promotion records provided." }, { status: 400 });
    }

    // Resolve nextSessionId if needed
    let effectiveNextSessionId = nextSessionId;
    let effectiveNextSession = nextSession;
    if (!effectiveNextSessionId && effectiveNextSession) {
      const { data: sessRow } = await service
        .from("academic_sessions")
        .select("id, name")
        .eq("name", effectiveNextSession)
        .maybeSingle();
      if (sessRow?.id) {
        effectiveNextSessionId = sessRow.id;
      } else {
        const { data: newSess } = await service
          .from("academic_sessions")
          .insert({ name: effectiveNextSession, status: "active", is_current: false })
          .select("id, name")
          .single();
        if (newSess?.id) {
          effectiveNextSessionId = newSess.id;
        }
      }
    }

    if (!effectiveNextSessionId) {
      // Find active academic session
      const { data: activeSess } = await service
        .from("academic_sessions")
        .select("id, name")
        .eq("status", "active")
        .single();
      effectiveNextSessionId = activeSess?.id;
      effectiveNextSession = activeSess?.name;
    }

    const summary: any[] = [];
    const classCache = new Map<string, any>();

    // Helper to get class details
    async function getClass(classId: string) {
      if (classCache.has(classId)) return classCache.get(classId);
      const { data } = await service.from("classes").select("id, name").eq("id", classId).maybeSingle();
      if (data) classCache.set(classId, data);
      return data;
    }

    // Process each student atomically
    for (const item of promotions) {
      const { studentId, studentName, fromClassId, toClassId, action = "promote" } = item;
      const fromClass = await getClass(fromClassId);
      const toClass = toClassId ? await getClass(toClassId) : null;

      if (action === "graduate") {
        // 1. Mark student as alumni
        await service.from("students").update({ is_alumni: true }).eq("id", studentId);

        // 2. Mark current enrollment graduated
        if (currentSessionId) {
          await service
            .from("student_enrollments")
            .update({ status: "graduated" })
            .eq("student_id", studentId)
            .eq("academic_session_id", currentSessionId);
        }

        summary.push({
          student_id: studentId,
          name: studentName,
          from_class: fromClass?.name || "Unknown",
          to_class: "Alumni (Graduated)",
          graduated: true,
          action: "graduated",
        });
      } else if (action === "repeat") {
        // Retained in same class for next session
        if (effectiveNextSessionId && fromClassId) {
          await service.from("student_enrollments").upsert(
            {
              student_id: studentId,
              class_id: fromClassId,
              academic_session_id: effectiveNextSessionId,
              session: effectiveNextSession,
              status: "active",
            },
            { onConflict: "student_id,academic_session_id" }
          );
        }

        summary.push({
          student_id: studentId,
          name: studentName,
          from_class: fromClass?.name || "Unknown",
          to_class: fromClass?.name || "Unknown",
          graduated: false,
          action: "repeat",
        });
      } else if (action === "promote" && toClassId) {
        // 1. Mark previous enrollment as promoted
        if (currentSessionId) {
          await service
            .from("student_enrollments")
            .update({ status: "promoted" })
            .eq("student_id", studentId)
            .eq("academic_session_id", currentSessionId);
        }

        // 2. Create active enrollment in new class for next session
        if (effectiveNextSessionId) {
          await service.from("student_enrollments").upsert(
            {
              student_id: studentId,
              class_id: toClassId,
              academic_session_id: effectiveNextSessionId,
              session: effectiveNextSession,
              status: "active",
            },
            { onConflict: "student_id,academic_session_id" }
          );
        }

        // 3. Update students.class_id cache
        await service.from("students").update({ class_id: toClassId }).eq("id", studentId);

        // 4. Auto-enroll into target curriculum subjects
        if (toClass && effectiveNextSessionId) {
          const isJss = isJuniorClass(toClass.name);
          const sssDefaults = getSSSTrackDefaults(toClass.name);
          const targetSubjects: string[] = isJss
            ? STANDARD_JSS_SUBJECTS
            : [...sssDefaults.core, ...sssDefaults.majors];

          const { data: dbSubjects } = await service.from("subjects").select("id, name");
          const subMap = new Map((dbSubjects || []).map((s: any) => [s.name.trim().toLowerCase(), s.id]));

          const ssePayload: any[] = [];
          for (const sName of targetSubjects) {
            const sId = subMap.get(sName.trim().toLowerCase());
            if (sId) {
              ssePayload.push({
                student_id: studentId,
                subject_id: sId,
                class_id: toClassId,
                academic_session_id: effectiveNextSessionId,
                session: effectiveNextSession,
                status: "enrolled",
                is_active: true,
              });
            }
          }

          if (ssePayload.length > 0) {
            await service
              .from("student_subject_enrollments")
              .upsert(ssePayload, { onConflict: "student_id,subject_id,session" });
          }
        }

        summary.push({
          student_id: studentId,
          name: studentName,
          from_class: fromClass?.name || "Unknown",
          to_class: toClass?.name || "Unknown",
          graduated: false,
          action: "promoted",
        });
      }
    }

    // 5. Record promotion history event
    const { data: promoRow, error: pErr } = await service
      .from("promotions")
      .insert({
        session: currentSession || effectiveNextSession,
        promoted_by: authId,
        summary,
        notes: notes?.trim() || null,
      })
      .select("id")
      .single();

    if (pErr) console.warn("Promotion history log warning:", pErr);

    return NextResponse.json({
      ok: true,
      message: `Successfully processed promotions for ${summary.length} students!`,
      summary,
      promotionId: promoRow?.id,
    });
  } catch (err: any) {
    console.error("Promotions API execution error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Failed to execute promotions." }, { status: 500 });
  }
}
