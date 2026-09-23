import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { isSeniorClass, getGradeAndRemark } from "@/lib/gradingEngine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("classId");
  const session = (searchParams.get("session") || "").trim();
  const term = searchParams.get("term") || "term1"; // term1, term2, term3, or annual

  if (!classId) {
    return NextResponse.json({ ok: false, error: "classId is required" }, { status: 400 });
  }

  try {
    // 1. Fetch Class details
    const { data: classRow, error: cErr } = await service
      .from("classes")
      .select("id, name")
      .eq("id", classId)
      .single();

    if (cErr || !classRow) {
      return NextResponse.json({ ok: false, error: "Class not found" }, { status: 404 });
    }

    const className = classRow.name;
    const isSenior = isSeniorClass(className);

    // 2. Resolve Students who were in this class during this session
    const studentMap = new Map<string, { id: string; name: string; admission_no: string }>();

    // Source A: student_enrollments for this class & session
    if (session) {
      const { data: enrollments } = await service
        .from("student_enrollments")
        .select("student_id, students(id, name, admission_no)")
        .eq("class_id", classId)
        .eq("session", session);

      (enrollments || []).forEach((e: any) => {
        if (e.students?.id) {
          studentMap.set(e.students.id, e.students);
        }
      });
    }

    // Source B: results table for this class & session
    let rQuery = service
      .from("results")
      .select("student_id, students(id, name, admission_no)")
      .eq("class_id", classId);
    if (session) rQuery = rQuery.eq("session", session);

    const { data: resStudents } = await rQuery;
    (resStudents || []).forEach((r: any) => {
      if (r.students?.id) {
        studentMap.set(r.students.id, r.students);
      }
    });

    // Source C: Active students in this class
    const { data: stds } = await service
      .from("students")
      .select("id, name, admission_no")
      .eq("class_id", classId);

    (stds || []).forEach((st: any) => {
      if (st?.id && !studentMap.has(st.id)) {
        if (!studentMap.size || !session) {
          studentMap.set(st.id, st);
        }
      }
    });

    // If still empty (e.g. historical session with no specific enrollments logged), include current class students
    if (studentMap.size === 0 && stds) {
      stds.forEach((st: any) => {
        if (st?.id) studentMap.set(st.id, st);
      });
    }

    const studentList = Array.from(studentMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    if (!studentList.length) {
      return NextResponse.json({
        ok: true,
        className,
        isSenior,
        session,
        term,
        studentsCount: 0,
        subjects: [],
        rows: [],
      });
    }

    const studentIds = studentList.map((s) => s.id);

    // 3. Fetch all scores for these students in this session/term
    let resQuery = service
      .from("results")
      .select(`
        id, student_id, subject_id, class_id, term, session,
        cw, hw, test, project, exam, total, grade, status,
        subjects(id, name)
      `)
      .in("student_id", studentIds);

    if (session) {
      resQuery = resQuery.eq("session", session);
    }
    if (term !== "annual") {
      resQuery = resQuery.eq("term", term);
    }

    const { data: results, error: rErr } = await resQuery;
    if (rErr) throw rErr;

    // Collect all subjects for this class and broadsheet
    const subjectsMap = new Map<string, string>();

    // 1. From results
    (results || []).forEach((r: any) => {
      if (r.subject_id && r.subjects?.name) {
        subjectsMap.set(r.subject_id, r.subjects.name);
      }
    });

    // 2. From student_subject_enrollments
    if (studentIds.length > 0) {
      let sseQuery = service
        .from("student_subject_enrollments")
        .select("student_id, subject_id, subjects(id, name)")
        .in("student_id", studentIds)
        .eq("status", "enrolled");
      if (session) sseQuery = sseQuery.eq("session", session);
      const { data: sseData } = await sseQuery;
      (sseData || []).forEach((se: any) => {
        if (se.subject_id && se.subjects?.name) {
          subjectsMap.set(se.subject_id, se.subjects.name);
        }
      });
    }

    // 3. From subject_teacher_assignments for this class
    const { data: staData } = await service
      .from("subject_teacher_assignments")
      .select("subject_id, subjects(id, name)")
      .eq("class_id", classId);
    (staData || []).forEach((a: any) => {
      if (a.subject_id && a.subjects?.name) {
        subjectsMap.set(a.subject_id, a.subjects.name);
      }
    });

    // 4. From legacy teacher_assignments for this class
    const { data: taData } = await service
      .from("teacher_assignments")
      .select("subject_id, subjects(id, name)")
      .eq("class_id", classId);
    (taData || []).forEach((a: any) => {
      if (a.subject_id && a.subjects?.name) {
        subjectsMap.set(a.subject_id, a.subjects.name);
      }
    });

    // 5. If still no subjects found, load all subjects from database
    if (subjectsMap.size === 0) {
      const { data: allSubs } = await service
        .from("subjects")
        .select("id, name")
        .order("name", { ascending: true });
      (allSubs || []).forEach((s: any) => {
        subjectsMap.set(s.id, s.name);
      });
    }

    const subjectList = Array.from(subjectsMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // 4. Group results by student & subject
    // studentId -> subjectId -> score details
    const studentScoreMap = new Map<string, Map<string, {
      total: number | null;
      grade: string;
      cw?: number | null;
      test?: number | null;
      exam?: number | null;
      term1?: number | null;
      term2?: number | null;
      term3?: number | null;
    }>>();

    if (term === "annual") {
      // Aggregate Term 1, Term 2, Term 3 for annual broadsheet
      (results || []).forEach((r: any) => {
        if (!studentScoreMap.has(r.student_id)) {
          studentScoreMap.set(r.student_id, new Map());
        }
        const sMap = studentScoreMap.get(r.student_id)!;
        if (!sMap.has(r.subject_id)) {
          sMap.set(r.subject_id, {
            total: null,
            grade: "—",
            cw: null,
            test: null,
            exam: null,
            term1: null,
            term2: null,
            term3: null,
          });
        }
        const subData = sMap.get(r.subject_id)!;
        const tot = r.total !== null && r.total !== undefined ? Number(r.total) : null;
        if (r.term === "term1") subData.term1 = tot;
        if (r.term === "term2") subData.term2 = tot;
        if (r.term === "term3") subData.term3 = tot;

        // Calculate average across valid terms
        const validTerms = [subData.term1, subData.term2, subData.term3].filter(
          (v): v is number => v !== null && v !== undefined && Number.isFinite(v)
        );
        if (validTerms.length > 0) {
          subData.total = +(validTerms.reduce((a, b) => a + b, 0) / validTerms.length).toFixed(1);
          const computedGrade = getGradeAndRemark(subData.total, isSenior).grade;
          subData.grade = r.grade && r.grade !== "—" ? r.grade : computedGrade;
        }
      });
    } else {
      (results || []).forEach((r: any) => {
        if (!studentScoreMap.has(r.student_id)) {
          studentScoreMap.set(r.student_id, new Map());
        }
        const sMap = studentScoreMap.get(r.student_id)!;
        const tot = r.total !== null && r.total !== undefined ? Number(r.total) : null;
        const computedGrade = tot !== null ? getGradeAndRemark(tot, isSenior).grade : "—";
        sMap.set(r.subject_id, {
          total: tot,
          grade: r.grade && r.grade !== "—" ? r.grade : computedGrade,
          cw: r.cw ?? null,
          test: r.test ?? null,
          exam: r.exam ?? null,
        });
      });
    }

    // 5. Build student broadsheet rows & calculate ranks
    const studentRows = studentList.map((st) => {
      const sMap = studentScoreMap.get(st.id) || new Map();
      const subjectScores: Record<string, {
        total: number | null;
        grade: string;
        cw: number | null;
        test: number | null;
        exam: number | null;
        term1?: number | null;
        term2?: number | null;
        term3?: number | null;
      }> = {};

      let totalScoreSum = 0;
      let evaluatedCount = 0;

      subjectList.forEach((sub) => {
        const sc = sMap.get(sub.id);
        if (sc && sc.total !== null && Number.isFinite(sc.total)) {
          subjectScores[sub.id] = {
            total: sc.total,
            grade: sc.grade,
            cw: sc.cw ?? null,
            test: sc.test ?? null,
            exam: sc.exam ?? null,
            term1: sc.term1 ?? null,
            term2: sc.term2 ?? null,
            term3: sc.term3 ?? null,
          };
          totalScoreSum += sc.total;
          evaluatedCount++;
        } else {
          subjectScores[sub.id] = {
            total: null,
            grade: "—",
            cw: null,
            test: null,
            exam: null,
            term1: null,
            term2: null,
            term3: null,
          };
        }
      });

      const average = evaluatedCount > 0 ? +(totalScoreSum / evaluatedCount).toFixed(1) : 0;

      return {
        studentId: st.id,
        name: st.name,
        admissionNo: st.admission_no,
        subjectScores,
        totalScore: +totalScoreSum.toFixed(1),
        evaluatedCount,
        average,
        position: 0,
      };
    });

    // Sort students by totalScore descending for class position ranking
    studentRows.sort((a, b) => b.totalScore - a.totalScore);

    // Assign positions with standard tie handling
    let currentRank = 1;
    for (let i = 0; i < studentRows.length; i++) {
      if (i > 0 && studentRows[i].totalScore === studentRows[i - 1].totalScore) {
        studentRows[i].position = studentRows[i - 1].position;
      } else {
        studentRows[i].position = currentRank;
      }
      currentRank++;
    }

    // 6. Compute Subject Benchmarks (Subject Average, High, Low)
    const subjectStats: Record<string, { avg: number; highest: number; lowest: number; count: number }> = {};
    subjectList.forEach((sub) => {
      const validScores = studentRows
        .map((r) => r.subjectScores[sub.id]?.total)
        .filter((sc): sc is number => sc !== null && sc !== undefined && Number.isFinite(sc));

      if (validScores.length > 0) {
        const sum = validScores.reduce((a, b) => a + b, 0);
        subjectStats[sub.id] = {
          avg: +(sum / validScores.length).toFixed(1),
          highest: Math.max(...validScores),
          lowest: Math.min(...validScores),
          count: validScores.length,
        };
      } else {
        subjectStats[sub.id] = { avg: 0, highest: 0, lowest: 0, count: 0 };
      }
    });

    // 7. Overall Class Summary
    const classTotalSum = studentRows.reduce((a, b) => a + b.average, 0);
    const classAverage = studentRows.length > 0 ? +(classTotalSum / studentRows.length).toFixed(1) : 0;

    return NextResponse.json({
      ok: true,
      className,
      isSenior,
      session,
      term,
      studentsCount: studentRows.length,
      subjectsCount: subjectList.length,
      classAverage,
      subjects: subjectList,
      subjectStats,
      rows: studentRows,
    });
  } catch (err: any) {
    console.error("Class broadsheet error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
