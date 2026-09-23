import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const studentId = searchParams.get("studentId");

  try {
    // Mode 1: Search students by name or admission number
    if (q && !studentId) {
      const { data: students, error } = await service
        .from("students")
        .select(`
          id, name, admission_no, gender, dob, class_id, portal_access_status,
          classes(id, name)
        `)
        .or(`name.ilike.%${q}%,admission_no.ilike.%${q}%`)
        .order("name", { ascending: true })
        .limit(20);

      if (error) throw error;
      return NextResponse.json({ ok: true, matches: students || [] });
    }

    // Mode 2: Full Student Results Career Profile for a specific student
    if (studentId) {
      // 1. Fetch student master record
      const { data: student, error: stdErr } = await service
        .from("students")
        .select(`
          id, name, admission_no, gender, dob, guardian_name, guardian_phone,
          portal_access_status, created_at,
          classes(id, name)
        `)
        .eq("id", studentId)
        .single();

      if (stdErr || !student) {
        return NextResponse.json({ ok: false, error: "Student not found" }, { status: 404 });
      }

      // 2. Fetch all historical session enrollments
      const { data: enrollments } = await service
        .from("student_enrollments")
        .select(`
          id, academic_session_id, session, class_id, status, enrolled_at,
          classes(id, name),
          academic_sessions(id, name, status)
        `)
        .eq("student_id", studentId)
        .order("session", { ascending: true });

      // 3. Fetch all historical results for this student
      const { data: results } = await service
        .from("results")
        .select(`
          id, student_id, subject_id, class_id, session, academic_session_id,
          term, cw, hw, test, project, exam, total, grade, status,
          pr1_status, pr2_status, pr3_status, tr_status,
          subjects(id, name),
          classes(id, name)
        `)
        .eq("student_id", studentId)
        .order("session", { ascending: true });

      // 4. Fetch all student subject enrollments across sessions
      const { data: subEnrollments } = await service
        .from("student_subject_enrollments")
        .select(`
          id, subject_id, session, academic_session_id, class_id, status, is_active,
          subjects(id, name),
          classes(id, name)
        `)
        .eq("student_id", studentId);

      // 5. Fetch all promotion events that mention this student
      const { data: promotions } = await service
        .from("promotions")
        .select("id, session, promoted_at, notes, summary")
        .order("promoted_at", { ascending: true });

      const studentPromotions = (promotions || []).filter((p: any) =>
        Array.isArray(p.summary) && p.summary.some((s: any) => s.student_id === studentId)
      );

      // Build session map to aggregate history
      const sessionsMap = new Map<string, {
        session: string;
        academicSessionId?: string | null;
        historicalClass: { id?: string; name: string };
        enrollmentStatus: string;
        terms: Record<string, {
          resultsCount: number;
          evaluatedCount: number;
          totalSum: number;
          average: number;
          results: any[];
        }>;
        enrolledSubjects: any[];
        annualAverage: number | null;
        promotionDetails: any | null;
      }>();

      // Seed sessions from enrollments
      (enrollments || []).forEach((e: any) => {
        const sessName = e.session || e.academic_sessions?.name || "Unknown Session";
        if (!sessionsMap.has(sessName)) {
          sessionsMap.set(sessName, {
            session: sessName,
            academicSessionId: e.academic_session_id,
            historicalClass: {
              id: e.class_id,
              name: e.classes?.name || "Unknown Class",
            },
            enrollmentStatus: e.status,
            terms: {
              term1: { resultsCount: 0, evaluatedCount: 0, totalSum: 0, average: 0, results: [] },
              term2: { resultsCount: 0, evaluatedCount: 0, totalSum: 0, average: 0, results: [] },
              term3: { resultsCount: 0, evaluatedCount: 0, totalSum: 0, average: 0, results: [] },
            },
            enrolledSubjects: [],
            annualAverage: null,
            promotionDetails: null,
          });
        }
      });

      // Seed or merge sessions from results
      (results || []).forEach((r: any) => {
        const sessName = r.session || "Unknown Session";
        if (!sessionsMap.has(sessName)) {
          sessionsMap.set(sessName, {
            session: sessName,
            academicSessionId: r.academic_session_id,
            historicalClass: {
              id: r.class_id,
              name: r.classes?.name || (student.classes as any)?.name || "Unknown Class",
            },
            enrollmentStatus: "active",
            terms: {
              term1: { resultsCount: 0, evaluatedCount: 0, totalSum: 0, average: 0, results: [] },
              term2: { resultsCount: 0, evaluatedCount: 0, totalSum: 0, average: 0, results: [] },
              term3: { resultsCount: 0, evaluatedCount: 0, totalSum: 0, average: 0, results: [] },
            },
            enrolledSubjects: [],
            annualAverage: null,
            promotionDetails: null,
          });
        }

        const sessObj = sessionsMap.get(sessName)!;
        // Prioritize results class name if historical class is unknown
        if (r.classes?.name && (!sessObj.historicalClass.name || sessObj.historicalClass.name === "Unknown Class")) {
          sessObj.historicalClass = { id: r.class_id, name: r.classes.name };
        }

        const t = r.term as "term1" | "term2" | "term3";
        if (sessObj.terms[t]) {
          sessObj.terms[t].results.push(r);
          sessObj.terms[t].resultsCount++;
          if (r.total !== null && r.total !== undefined && Number.isFinite(Number(r.total))) {
            sessObj.terms[t].evaluatedCount++;
            sessObj.terms[t].totalSum += Number(r.total);
          }
        }
      });

      // Attach subject enrollments to sessions
      (subEnrollments || []).forEach((se: any) => {
        const sessName = se.session || "Unknown Session";
        if (sessionsMap.has(sessName)) {
          sessionsMap.get(sessName)!.enrolledSubjects.push(se);
        }
      });

      // Calculate term averages and annual average
      sessionsMap.forEach((sess) => {
        let termAvgsSum = 0;
        let termAvgsCount = 0;

        (["term1", "term2", "term3"] as const).forEach((t) => {
          const tObj = sess.terms[t];
          if (tObj.evaluatedCount > 0) {
            tObj.average = +(tObj.totalSum / tObj.evaluatedCount).toFixed(1);
            termAvgsSum += tObj.average;
            termAvgsCount++;
          }
        });

        sess.annualAverage = termAvgsCount > 0 ? +(termAvgsSum / termAvgsCount).toFixed(1) : null;

        // Match promotion record
        const promo = studentPromotions.find((p: any) => p.session === sess.session);
        if (promo) {
          const sumItem = promo.summary.find((s: any) => s.student_id === studentId);
          sess.promotionDetails = {
            promoted_at: promo.promoted_at,
            from_class: sumItem?.from_class,
            to_class: sumItem?.to_class,
            graduated: sumItem?.graduated,
            notes: promo.notes,
          };
        }
      });

      // Sort sessions chronologically
      const history = Array.from(sessionsMap.values()).sort((a, b) =>
        a.session.localeCompare(b.session)
      );

      return NextResponse.json({
        ok: true,
        student,
        currentClass: (student.classes as any)?.name || "Unassigned",
        history,
      });
    }

    return NextResponse.json({ ok: false, error: "Missing query or studentId" }, { status: 400 });
  } catch (err: any) {
    console.error("Historical lookup error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
