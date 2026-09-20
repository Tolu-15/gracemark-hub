import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ error: "Server service client unavailable." }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("class_id");
  const subjectId = searchParams.get("subject_id");
  const term = searchParams.get("term") || "term1";
  const session = searchParams.get("session");

  if (!classId) {
    return NextResponse.json({ error: "class_id is required." }, { status: 400 });
  }

  try {
    // 1. Fetch students enrolled in this class
    let students: any[] = [];
    const { data: enrollments } = await service
      .from("student_enrollments")
      .select("student_id, students(id, name, admission_no)")
      .eq("class_id", classId)
      .eq("status", "active");

    if (enrollments && enrollments.length > 0) {
      students = enrollments
        .map((e: any) => e.students)
        .filter(Boolean);
    }

    if (!students.length) {
      const { data: stdList } = await service
        .from("students")
        .select("id, name, admission_no")
        .eq("class_id", classId);
      students = stdList || [];
    }

    const studentMap = new Map<string, { id: string; name: string; admission_no: string }>();
    students.forEach((s) => studentMap.set(s.id, s));
    const studentIds = Array.from(studentMap.keys());

    if (!studentIds.length) {
      return NextResponse.json({ ok: true, results: [] });
    }

    // 2. Fetch all subjects for clean name lookup
    const { data: allSubjects } = await service
      .from("subjects")
      .select("id, name");
    const subjectMap = new Map<string, string>();
    (allSubjects || []).forEach((sub) => subjectMap.set(sub.id, sub.name));

    // 3. Query results for these students in this term
    let resultsQuery = service
      .from("results")
      .select("id, student_id, subject_id, cw, hw, test, project, exam, total, grade, remark, status, session, term")
      .in("student_id", studentIds)
      .eq("term", term);

    if (subjectId) {
      resultsQuery = resultsQuery.eq("subject_id", subjectId);
    }

    if (session) {
      resultsQuery = resultsQuery.eq("session", session);
    }

    let { data: resData, error: resErr } = await resultsQuery;

    // If session filter yielded no results, fallback without strict session match
    if ((!resData || resData.length === 0) && session) {
      let fallbackQuery = service
        .from("results")
        .select("id, student_id, subject_id, cw, hw, test, project, exam, total, grade, remark, status, session, term")
        .in("student_id", studentIds)
        .eq("term", term);

      if (subjectId) {
        fallbackQuery = fallbackQuery.eq("subject_id", subjectId);
      }
      const fbResult = await fallbackQuery;
      if (fbResult.data && fbResult.data.length > 0) {
        resData = fbResult.data;
      }
    }

    if (resErr) {
      console.error("Gradebook results fetch error:", resErr);
      throw resErr;
    }

    // 4. Format and enrich results with student and subject information
    const enrichedResults = (resData || []).map((r: any) => {
      const student = studentMap.get(r.student_id);
      const subjectName = subjectMap.get(r.subject_id) || "Subject";
      return {
        id: r.id,
        student_id: r.student_id,
        subject_id: r.subject_id,
        cw: r.cw,
        hw: r.hw,
        test: r.test,
        project: r.project,
        exam: r.exam,
        total: r.total,
        grade: r.grade,
        remark: r.remark,
        status: r.status,
        session: r.session,
        term: r.term,
        students: student ? { id: student.id, name: student.name, admission_no: student.admission_no } : null,
        subjects: { name: subjectName },
      };
    });

    // Sort by total descending
    enrichedResults.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));

    return NextResponse.json({
      ok: true,
      results: enrichedResults,
    });
  } catch (err: any) {
    console.error("GET /api/teacher/gradebook error:", err);
    return NextResponse.json({ error: err.message || "Failed to load gradebook results." }, { status: 500 });
  }
}
