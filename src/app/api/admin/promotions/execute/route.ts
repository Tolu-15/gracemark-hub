import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service, dbUserId } = authorization.actor;
  const actor = authorization.actor;

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

    // The verdict comes from each student's published 3rd-term Terminal Result, whose
    // overall percentage is the average of the three terms (annual average). Students
    // without one are skipped, and a REPEAT verdict cannot be promoted, unless the admin
    // explicitly overrode that student on the promotions page.
    let gateSessionId = currentSessionId as string | undefined;
    if (!gateSessionId && currentSession) {
      const { data: gs } = await service.from("academic_sessions").select("id").eq("name", currentSession).maybeSingle();
      gateSessionId = gs?.id;
    }
    const verdictByStudent = new Map<string, { status: string; pct: number | null }>();
    if (gateSessionId) {
      const ids = promotions.map((p: any) => p.studentId).filter(Boolean);
      const { data: enr } = await service
        .from("student_enrollments")
        .select("id, student_id")
        .eq("academic_session_id", gateSessionId)
        .in("student_id", ids);
      const studentByEnrollment = new Map((enr || []).map((e: any) => [e.id, e.student_id]));
      if (studentByEnrollment.size) {
        const { data: snaps } = await service
          .from("result_snapshots")
          .select("enrollment_id, snapshot_data")
          .eq("term", "term3")
          .eq("report_type", "TR")
          .in("enrollment_id", Array.from(studentByEnrollment.keys()));
        (snaps || []).forEach((s: any) => {
          const sid = studentByEnrollment.get(s.enrollment_id);
          const st = s.snapshot_data?.promotion?.status;
          if (sid && st) verdictByStudent.set(sid, { status: st, pct: s.snapshot_data?.summary?.percentage ?? null });
        });
      }
    }

    const skipped: { name: string; reason: string }[] = [];
    let overridden = 0;
    const effective: any[] = [];
    for (const item of promotions) {
      if (item.override) {
        overridden++;
        effective.push(item);
        continue;
      }
      const verdict = verdictByStudent.get(item.studentId);
      if (!verdict) {
        skipped.push({ name: item.studentName || "Student", reason: "3rd-term result not published" });
        continue;
      }
      if (verdict.status === "REPEAT" && item.action !== "repeat") {
        effective.push({ ...item, action: "repeat", toClassId: undefined });
      } else {
        effective.push(item);
      }
    }

    // Process each student atomically
    for (const item of effective) {
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
          from_class_id: fromClassId,
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
              status: "active",
            },
            { onConflict: "student_id,academic_session_id" }
          );
        }

        summary.push({
          student_id: studentId,
          name: studentName,
          from_class: fromClass?.name || "Unknown",
          from_class_id: fromClassId,
          to_class_id: fromClassId,
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
              status: "active",
            },
            { onConflict: "student_id,academic_session_id" }
          );
        }

        // 3. Update students.current_class_id cache (with fallback to class_id)
        const { error: cErr } = await service.from("students").update({ current_class_id: toClassId }).eq("id", studentId);
        if (cErr) {
          await service.from("students").update({ class_id: toClassId }).eq("id", studentId);
        }

        // 4. Subjects follow the new class's subject list automatically. Carry the
        //    student's "Not offering" marks into the next session for subjects the
        //    new class also offers, so teachers don't have to tick them again.
        if (toClass && currentSession && effectiveNextSession && currentSession !== effectiveNextSession) {
          const [{ data: optouts }, { data: toCls }] = await Promise.all([
            service.from("student_subject_optouts").select("subject_id").eq("student_id", studentId).eq("session", currentSession),
            service.from("classes").select("subject_group_code").eq("id", toClassId).maybeSingle(),
          ]);
          if (optouts?.length && toCls?.subject_group_code) {
            const { data: list } = await service
              .from("subject_group_subjects")
              .select("subject_id")
              .eq("group_code", toCls.subject_group_code);
            const offered = new Set((list || []).map((l: any) => l.subject_id));
            const carry = optouts
              .filter((o: any) => offered.has(o.subject_id))
              .map((o: any) => ({ student_id: studentId, subject_id: o.subject_id, session: effectiveNextSession }));
            if (carry.length) {
              await service.from("student_subject_optouts").upsert(carry, { onConflict: "student_id,subject_id,session" });
            }
          }
        }

        summary.push({
          student_id: studentId,
          name: studentName,
          from_class: fromClass?.name || "Unknown",
          from_class_id: fromClassId,
          to_class_id: toClassId,
          to_class: toClass?.name || "Unknown",
          graduated: false,
          action: "promoted",
        });
      }
    }

    // 5. Record promotion history event
    let fromSessionId = currentSessionId;
    if (!fromSessionId && currentSession) {
      const { data: fromSess } = await service.from("academic_sessions").select("id").eq("name", currentSession).maybeSingle();
      fromSessionId = fromSess?.id;
    }
    const { data: promoRow, error: pErr } = await service
      .from("promotions")
      .insert({
        from_session_id: fromSessionId || effectiveNextSessionId,
        to_session_id: effectiveNextSessionId || fromSessionId,
        promoted_by: dbUserId,
        summary,
        notes: notes?.trim() || null,
      })
      .select("id")
      .single();

    if (pErr) console.warn("Promotion history log warning:", pErr);

    await logAudit(actor, {
      action: "promotion.execute",
      entityType: "promotion",
      entityId: promoRow?.id,
      summary: `Promoted ${summary.length} students (${currentSession || "?"} → ${effectiveNextSession || "?"})`,
      metadata: {
        promoted: summary.filter((s) => s.action === "promoted").length,
        graduated: summary.filter((s) => s.action === "graduated").length,
        repeated: summary.filter((s) => s.action === "repeat").length,
        skipped_unpublished: skipped.length,
        admin_overrides: overridden,
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Processed ${summary.length} students.${skipped.length ? ` ${skipped.length} skipped (3rd-term result not published).` : ""}`,
      skipped,
      summary,
      promotionId: promoRow?.id,
    });
  } catch (err: any) {
    console.error("Promotions API execution error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Failed to execute promotions." }, { status: 500 });
  }
}
