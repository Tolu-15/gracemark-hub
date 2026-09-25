import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

const TERMS = ["term1", "term2", "term3"] as const;
const ORDER = ["PR1", "PR2", "PR3", "TR"];

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const studentId = sp.get("studentId");

  try {
    // Mode 1: search by name or admission number
    if (q && !studentId) {
      const safe = q.replace(/[,()%*]/g, " ").trim();
      if (!safe) return NextResponse.json({ ok: true, matches: [] });
      const { data: students, error } = await service
        .from("students")
        .select("id, name, admission_no, class_id, classes:class_id(id, name)")
        .or(`name.ilike.%${safe}%,full_name.ilike.%${safe}%,admission_no.ilike.%${safe}%`)
        .order("name", { ascending: true })
        .limit(20);
      if (error) throw error;
      return NextResponse.json({ ok: true, matches: students || [] });
    }

    // Mode 2: a student's record across sessions
    if (studentId) {
      const { data: student, error: stdErr } = await service
        .from("students")
        .select("id, name, admission_no, gender, date_of_birth, guardian_name, guardian_phone, is_alumni, classes:class_id(id, name)")
        .eq("id", studentId)
        .maybeSingle();
      if (stdErr) throw stdErr;
      if (!student) return NextResponse.json({ ok: false, error: "Student not found" }, { status: 404 });

      const [{ data: enrollments }, { data: results }, { data: promotions }, { data: sessionRows }] = await Promise.all([
        service
          .from("student_enrollments")
          .select("id, academic_session_id, class_id, status, classes(id, name), academic_sessions(id, name, start_date)")
          .eq("student_id", studentId),
        service.from("results").select("session, term, status").eq("student_id", studentId),
        service.from("promotions").select("from_session_id, promoted_at, notes, summary").order("promoted_at"),
        service.from("academic_sessions").select("id, name"),
      ]);

      const enrollIds = (enrollments || []).map((e: any) => e.id);
      const { data: snaps } = enrollIds.length
        ? await service
            .from("result_snapshots")
            .select("enrollment_id, term, report_type, published_at, snapshot_data")
            .in("enrollment_id", enrollIds)
        : { data: [] };

      const sessionName = new Map((sessionRows || []).map((s: any) => [s.id, s.name]));
      const history = (enrollments || [])
        .map((e: any) => {
          const sess = e.academic_sessions?.name || sessionName.get(e.academic_session_id) || "Unknown session";
          const terms: Record<string, any> = {};
          TERMS.forEach((t) => {
            const termSnaps = (snaps || []).filter((s: any) => s.enrollment_id === e.id && s.term === t);
            const tr = termSnaps.find((s: any) => s.report_type === "TR")?.snapshot_data?.summary || null;
            const scoresEntered = (results || []).filter((r: any) => r.session === sess && r.term === t).length;
            terms[t] = {
              published: termSnaps.map((s: any) => s.report_type).sort((a: string, b: string) => ORDER.indexOf(a) - ORDER.indexOf(b)),
              tr: tr
                ? { percentage: tr.percentage, grade: tr.grade, remark: tr.remark, gpa: tr.gpa, position: tr.position, rankedCount: tr.rankedCount }
                : null,
              scoresEntered,
            };
          });
          const trAverages = TERMS.map((t) => terms[t].tr?.percentage).filter((v): v is number => typeof v === "number");
          const promo = (promotions || []).find(
            (p: any) => p.from_session_id === e.academic_session_id && Array.isArray(p.summary) && p.summary.some((x: any) => x.student_id === studentId)
          );
          const item = promo?.summary.find((x: any) => x.student_id === studentId);
          return {
            session: sess,
            start: e.academic_sessions?.start_date || "",
            historicalClass: { id: e.class_id, name: e.classes?.name || "Unknown class" },
            enrollmentStatus: e.status,
            terms,
            annualAverage: trAverages.length ? Math.round((trAverages.reduce((a, b) => a + b, 0) / trAverages.length) * 10) / 10 : null,
            promotionDetails: item && promo
              ? { promoted_at: promo.promoted_at, from_class: item.from_class, to_class: item.to_class, action: item.action, notes: promo.notes }
              : null,
          };
        })
        .sort((a: any, b: any) => (a.start || a.session).localeCompare(b.start || b.session));

      return NextResponse.json({
        ok: true,
        student,
        currentClass: (student as any).classes?.name || "Unassigned",
        history,
      });
    }

    return NextResponse.json({ ok: false, error: "Missing query or studentId" }, { status: 400 });
  } catch (err: any) {
    console.error("Historical lookup error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
