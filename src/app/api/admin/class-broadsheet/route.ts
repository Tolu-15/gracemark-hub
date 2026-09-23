import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { isSeniorClass } from "@/lib/gradingEngine";

export async function GET(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Database client unavailable" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("classId");
  const session = searchParams.get("session") || "";
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
    let studentList: { id: string; name: string; admission_no: string }[] = [];

    // Try student_enrollments first
    if (session) {
      const { data: enrollments } = await service
        .from("student_enrollments")
        .select("student_id, students(id, name, admission_no)")
        .eq("class_id", classId)
        .eq("session", session);

      if (enrollments && enrollments.length > 0) {
        studentList = enrollments
          .map((e: any) => e.students)
          .filter(Boolean);
      }
    }

    // Try results table if student_enrollments is empty
    if (!studentList.length && session) {
      const { data: resStudents } = await service
        .from("results")
        .select("student_id, students(id, name, admission_no)")
        .eq("class_id", classId)
        .eq("session", session);

      if (resStudents && resStudents.length > 0) {
        const seen = new Set<string>();
        resStudents.forEach((r: any) => {
          if (r.students && !seen.has(r.student_id)) {
            seen.add(r.student_id);
            studentList.push(r.students);
          }
        });
      }
    }

    // Fallback to active students in class
    if (!studentList.length) {
      const { data: stds } = await service
        .from("students")
        .select("id, name, admission_no")
        .eq("class_id", classId);
      studentList = stds || [];
    }

    studentList.sort((a, b) => a.name.localeCompare(b.name));

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

    // 3. Fetch all subjects taken by this class / students
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

    // Collect unique subjects
    const subjectsMap = new Map<string, string>();
    (results || []).forEach((r: any) => {
      if (r.subject_id && r.subjects?.name) {
        subjectsMap.set(r.subject_id, r.subjects.name);
      }
    });

    // Also check student_subject_enrollments for any additional subjects
    const { data: subEnrolled } = await service
      .from("student_subject_enrollments")
      .select("subject_id, subjects(id, name)")
      .eq("class_id", classId)
      .eq("status", "enrolled");

    (subEnrolled || []).forEach((se: any) => {
      if (se.subject_id && se.subjects?.name) {
        subjectsMap.set(se.subject_id, se.subjects.name);
      }
    });

    const subjectList = Array.from(subjectsMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // 4. Group results by student & subject
    // studentId -> subjectId -> { total, grade, cw, test, exam }
    const studentScoreMap = new Map<string, Map<string, {
      total: number | null;
      grade: string;
      cw?: number;
      test?: number;
      exam?: number;
      term1?: number;
      term2?: number;
      term3?: number;
    }>>();

    if (term === "annual") {
      // Aggregate Term 1, Term 2, Term 3 for annual broadsheet
      (results || []).forEach((r: any) => {
        if (!studentScoreMap.has(r.student_id)) {
          studentScoreMap.set(r.student_id, new Map());
        }
        const sMap = studentScoreMap.get(r.student_id)!;
        if (!sMap.has(r.subject_id)) {
          sMap.set(r.subject_id, { total: null, grade: "—", term1: undefined, term2: undefined, term3: undefined });
        }
        const subData = sMap.get(r.subject_id)!;
        const tot = r.total !== null && r.total !== undefined ? Number(r.total) : null;
        if (r.term === "term1") subData.term1 = tot ?? undefined;
        if (r.term === "term2") subData.term2 = tot ?? undefined;
        if (r.term === "term3") subData.term3 = tot ?? undefined;

        // Calculate average across available terms
        const validTerms = [subData.term1, subData.term2, subData.term3].filter(
          (v): v is number => v !== undefined && v !== null && Number.isFinite(v)
        );
        if (validTerms.length > 0) {
          subData.total = +(validTerms.reduce((a, b) => a + b, 0) / validTerms.length).toFixed(1);
          subData.grade = r.grade || "—";
        }
      });
    } else {
      (results || []).forEach((r: any) => {
        if (!studentScoreMap.has(r.student_id)) {
          studentScoreMap.set(r.student_id, new Map());
        }
        const sMap = studentScoreMap.get(r.student_id)!;
        sMap.set(r.subject_id, {
          total: r.total !== null && r.total !== undefined ? Number(r.total) : null,
          grade: r.grade || "—",
          cw: r.cw,
          test: r.test,
          exam: r.exam,
        });
      });
    }

    // 5. Build student broadsheet rows & calculate ranks
    const studentRows = studentList.map((st) => {
      const sMap = studentScoreMap.get(st.id) || new Map();
      const subjectScores: Record<string, { total: number | null; grade: string }> = {};

      let totalScoreSum = 0;
      let evaluatedCount = 0;

      subjectList.forEach((sub) => {
        const sc = sMap.get(sub.id);
        if (sc && sc.total !== null && Number.isFinite(sc.total)) {
          subjectScores[sub.id] = { total: sc.total, grade: sc.grade };
          totalScoreSum += sc.total;
          evaluatedCount++;
        } else {
          subjectScores[sub.id] = { total: null, grade: "—" };
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
