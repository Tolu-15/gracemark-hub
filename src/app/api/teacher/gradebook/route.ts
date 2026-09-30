import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

function getGradeRemark(total: number, grade?: string): string {
  if (grade === "A" || total >= 75) return "Excellent";
  if (grade === "B" || total >= 65) return "Very Good";
  if (grade === "C" || total >= 50) return "Credit";
  if (grade === "D" || total >= 45) return "Pass";
  if (grade === "E" || total >= 40) return "Fair";
  return "Fail";
}

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service } = actor;

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("class_id");
  const subjectId = searchParams.get("subject_id");
  const term = searchParams.get("term") || "term1";
  const session = searchParams.get("session");

  if (!classId) {
    return NextResponse.json({ error: "class_id is required." }, { status: 400 });
  }

  // This is the "Class Teacher Gradebook" — a cross-subject master view. A teacher
  // who is actually the class teacher of classId gets the full view; a teacher who
  // only teaches one subject there may only ever see that subject's own results,
  // never every other subject's grades for students they don't teach.
  let restrictToSubjectIds: string[] | null = null;
  if (actor.role === "teacher") {
    const idList = Array.from(new Set([actor.authId, actor.dbUserId].filter(Boolean))) as string[];

    const [{ data: classRow }, { data: ctaRows }, { data: staRows }] = await Promise.all([
      service.from("classes").select("class_teacher_id").eq("id", classId).maybeSingle(),
      service.from("class_teacher_assignments").select("id").eq("class_id", classId).in("teacher_user_id", idList).eq("status", "active"),
      service.from("subject_teacher_assignments").select("subject_id").eq("class_id", classId).in("teacher_user_id", idList).eq("status", "active"),
    ]);

    const isClassTeacher = (classRow?.class_teacher_id && idList.includes(classRow.class_teacher_id)) || Boolean(ctaRows?.length);
    const assignedSubjectIds = (staRows || []).map((r: any) => r.subject_id).filter(Boolean);

    if (!isClassTeacher) {
      if (!assignedSubjectIds.length) {
        return NextResponse.json({ error: "You are not assigned to this class." }, { status: 403 });
      }
      if (subjectId && !assignedSubjectIds.includes(subjectId)) {
        return NextResponse.json({ error: "You are not assigned to that subject in this class." }, { status: 403 });
      }
      restrictToSubjectIds = subjectId ? [subjectId] : assignedSubjectIds;
    }
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

    // Applies the subject filter: an explicit subject_id pick (admin/class teacher),
    // or the hard restriction computed above for a subject-only teacher — never both
    // unset when restrictToSubjectIds is present, since that's already narrowed to
    // exactly what this teacher is allowed to see.
    function applySubjectFilter(query: any): any {
      if (restrictToSubjectIds) return query.in("subject_id", restrictToSubjectIds);
      if (subjectId) return query.eq("subject_id", subjectId);
      return query;
    }

    // 2. Fetch all subjects for clean name lookup
    const { data: allSubjects } = await service
      .from("subjects")
      .select("id, name");
    const subjectMap = new Map<string, string>();
    (allSubjects || []).forEach((sub) => subjectMap.set(sub.id, sub.name));

    // 3. Query results for this class and term
    // (Note: 'remark' column does not exist on results table)
    let resultsQuery = applySubjectFilter(
      service
        .from("results")
        .select("id, student_id, class_id, subject_id, cw, hw, test, project, exam, total, grade, status, session, term")
        .eq("class_id", classId)
        .eq("term", term)
    );

    if (session) {
      resultsQuery = resultsQuery.eq("session", session);
    }

    let { data: resData, error: resErr } = await resultsQuery;

    // Fallback 1: If no results found with strict session, search without session filter
    if ((!resData || resData.length === 0) && session) {
      const fallbackQuery = applySubjectFilter(
        service
          .from("results")
          .select("id, student_id, class_id, subject_id, cw, hw, test, project, exam, total, grade, status, session, term")
          .eq("class_id", classId)
          .eq("term", term)
      );

      const fbResult = await fallbackQuery;
      if (fbResult.data && fbResult.data.length > 0) {
        resData = fbResult.data;
      }
    }

    // Fallback 2: If results table doesn't have class_id set on older rows, query by student_id list
    if ((!resData || resData.length === 0) && studentIds.length > 0) {
      const byStudentQuery = applySubjectFilter(
        service
          .from("results")
          .select("id, student_id, class_id, subject_id, cw, hw, test, project, exam, total, grade, status, session, term")
          .in("student_id", studentIds)
          .eq("term", term)
      );

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
        const allowedNames = restrictToSubjectIds
          ? new Set(restrictToSubjectIds.map((id) => subjectMap.get(id)?.toLowerCase()).filter(Boolean))
          : null;
        const seen = new Set<string>();
        for (const snap of snapshots) {
          const student = studentMap.get(snap.student_id);
          const snapSubs = snap.snapshot_data?.subjects || [];
          for (const sub of snapSubs) {
            const subName = sub.subject_name || "Subject";
            if (allowedNames && !allowedNames.has(subName.toLowerCase())) {
              continue;
            }
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
