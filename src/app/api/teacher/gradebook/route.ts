import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

function getGradeRemark(total: number, grade?: string): string {
  if (grade === "A" || total >= 75) return "Excellent";
  if (grade === "B" || total >= 65) return "Very Good";
  if (grade === "C" || total >= 50) return "Credit";
  if (grade === "D" || total >= 45) return "Pass";
  if (grade === "E" || total >= 40) return "Fair";
  return "Fail";
}

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
    // 1. Fetch students enrolled in this class (combine enrollments + direct class_id in students table)
    const [enrollmentRes, studentRes] = await Promise.all([
      service
        .from("student_enrollments")
        .select("student_id, students(id, name, admission_no)")
        .eq("class_id", classId)
        .eq("status", "active"),
      service
        .from("students")
        .select("id, name, admission_no")
        .eq("class_id", classId),
    ]);

    const studentMap = new Map<string, { id: string; name: string; admission_no: string }>();

    (enrollmentRes.data || []).forEach((e: any) => {
      if (e.students?.id) {
        studentMap.set(e.students.id, {
          id: e.students.id,
          name: e.students.name || "Student",
          admission_no: e.students.admission_no || "—",
        });
      }
    });

    (studentRes.data || []).forEach((s: any) => {
      if (s.id && !studentMap.has(s.id)) {
        studentMap.set(s.id, {
          id: s.id,
          name: s.name || "Student",
          admission_no: s.admission_no || "—",
        });
      }
    });

    const studentIds = Array.from(studentMap.keys());

    // 2. Fetch all subjects for clean name lookup
    const { data: allSubjects } = await service
      .from("subjects")
      .select("id, name");
    const subjectMap = new Map<string, string>();
    (allSubjects || []).forEach((sub) => subjectMap.set(sub.id, sub.name));

    // 3. Query results for this class and term
    // (Note: 'remark' column does not exist on results table)
    let resultsQuery = service
      .from("results")
      .select("id, student_id, class_id, subject_id, cw, hw, test, project, exam, total, grade, status, session, term")
      .eq("class_id", classId)
      .eq("term", term);

    if (subjectId) {
      resultsQuery = resultsQuery.eq("subject_id", subjectId);
    }
    if (session) {
      resultsQuery = resultsQuery.eq("session", session);
    }

    let { data: resData, error: resErr } = await resultsQuery;

    // Fallback 1: If no results found with strict session, search without session filter
    if ((!resData || resData.length === 0) && session) {
      let fallbackQuery = service
        .from("results")
        .select("id, student_id, class_id, subject_id, cw, hw, test, project, exam, total, grade, status, session, term")
        .eq("class_id", classId)
        .eq("term", term);

      if (subjectId) {
        fallbackQuery = fallbackQuery.eq("subject_id", subjectId);
      }
      const fbResult = await fallbackQuery;
      if (fbResult.data && fbResult.data.length > 0) {
        resData = fbResult.data;
      }
    }

    // Fallback 2: If results table doesn't have class_id set on older rows, query by student_id list
    if ((!resData || resData.length === 0) && studentIds.length > 0) {
      let byStudentQuery = service
        .from("results")
        .select("id, student_id, class_id, subject_id, cw, hw, test, project, exam, total, grade, status, session, term")
        .in("student_id", studentIds)
        .eq("term", term);

      if (subjectId) {
        byStudentQuery = byStudentQuery.eq("subject_id", subjectId);
      }
      const bsResult = await byStudentQuery;
      if (bsResult.data && bsResult.data.length > 0) {
        resData = bsResult.data;
      }
    }

    if (resErr && (!resData || resData.length === 0)) {
      console.error("Gradebook results fetch error:", resErr);
      throw resErr;
    }

    let enrichedResults: any[] = [];

    if (resData && resData.length > 0) {
      enrichedResults = resData.map((r: any) => {
        const student = studentMap.get(r.student_id);
        const subjectName = subjectMap.get(r.subject_id) || "Subject";
        const tot = Number(r.total) || 0;
        return {
          id: r.id,
          student_id: r.student_id,
          subject_id: r.subject_id,
          cw: r.cw ?? 0,
          hw: r.hw ?? 0,
          test: r.test ?? 0,
          project: r.project ?? 0,
          exam: r.exam ?? 0,
          total: tot,
          grade: r.grade || "—",
          remark: getGradeRemark(tot, r.grade),
          status: r.status || "draft",
          session: r.session,
          term: r.term,
          students: student
            ? { id: student.id, name: student.name, admission_no: student.admission_no }
            : { id: r.student_id, name: "Student", admission_no: "—" },
          subjects: { name: subjectName },
        };
      });
    } else {
      // Fallback 3: If results table is empty, check published_snapshots
      const { data: snapshots } = await service
        .from("published_snapshots")
        .select("id, student_id, class_id, term, session, report_type, snapshot_data")
        .eq("class_id", classId)
        .eq("term", term)
        .order("published_at", { ascending: false });

      if (snapshots && snapshots.length > 0) {
        const seen = new Set<string>();
        for (const snap of snapshots) {
          const student = studentMap.get(snap.student_id);
          const snapSubs = snap.snapshot_data?.subjects || [];
          for (const sub of snapSubs) {
            const subName = sub.subject_name || "Subject";
            if (subjectId) {
              const matchedSub = allSubjects?.find((s) => s.id === subjectId);
              if (matchedSub && matchedSub.name.toLowerCase() !== subName.toLowerCase()) {
                continue;
              }
            }
            const key = `${snap.student_id}-${subName}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const tot = Number(sub.total) || 0;
            enrichedResults.push({
              id: `${snap.id}-${subName}`,
              student_id: snap.student_id,
              subject_id: subjectId || "",
              cw: sub.cw ?? 0,
              hw: sub.hw ?? 0,
              test: sub.test ?? 0,
              project: sub.project ?? 0,
              exam: sub.exam ?? 0,
              total: tot,
              grade: sub.grade || "—",
              remark: sub.remark || getGradeRemark(tot, sub.grade),
              status: "published",
              session: snap.session,
              term: snap.term,
              students: student
                ? { id: student.id, name: student.name, admission_no: student.admission_no }
                : { id: snap.student_id, name: "Student", admission_no: "—" },
              subjects: { name: subName },
            });
          }
        }
      }
    }

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
