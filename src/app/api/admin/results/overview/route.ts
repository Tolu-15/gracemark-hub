import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { getClassSubjects, getOptOuts, MIGRATION_HINT } from "@/lib/subjectGroups";
import { buildClassReports, MILESTONES, STATUS_COLUMN } from "@/lib/reportBuilder";

/**
 * GET ?class_id=&term=
 * Class × subject review grid, publication state of each milestone and the
 * readiness check for each milestone, for the current session.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const sp = req.nextUrl.searchParams;
  const classId = sp.get("class_id") || "";
  const { data: settings } = await service
    .from("app_settings")
    .select("current_term, current_session, current_session_id")
    .limit(1)
    .maybeSingle();
  const term = sp.get("term") || settings?.current_term || "term1";
  const session = settings?.current_session || "";
  if (!classId) return NextResponse.json({ ok: false, error: "class_id is required." }, { status: 400 });
  if (!session) return NextResponse.json({ ok: false, error: "No current session is set in settings." }, { status: 400 });

  try {
    const subjects = await getClassSubjects(service, classId);
    const { data: students } = await service.from("students").select("id, name").eq("class_id", classId);
    const studentIds = (students || []).map((s: any) => s.id);
    const optOuts = await getOptOuts(service, session, studentIds);

    const [resultsRes, assignRes] = await Promise.all([
      studentIds.length
        ? service
            .from("results")
            .select("id, student_id, subject_id, status, return_reason, updated_at, pr1_status, pr2_status, pr3_status, tr_status")
            .eq("term", term)
            .eq("session", session)
            .in("student_id", studentIds)
        : Promise.resolve({ data: [], error: null }),
      service
        .from("subject_teacher_assignments")
        .select("subject_id, teacher_user_id")
        .eq("class_id", classId)
        .eq("status", "active")
        .eq("academic_session_id", settings?.current_session_id || ""),
    ]);
    if (resultsRes.error) throw resultsRes.error;

    const teacherIds = Array.from(new Set((assignRes.data || []).map((a: any) => a.teacher_user_id)));
    const { data: users } = teacherIds.length
      ? await service.from("users").select("id, auth_id, display_name").or(`id.in.(${teacherIds.join(",")}),auth_id.in.(${teacherIds.join(",")})`)
      : { data: [] };
    const nameOf = new Map<string, string>();
    (users || []).forEach((u: any) => {
      nameOf.set(u.id, u.display_name || "Teacher");
      if (u.auth_id) nameOf.set(u.auth_id, u.display_name || "Teacher");
    });

    const rows = resultsRes.data || [];
    const grid = subjects.map((subj) => {
      const subjRows = rows.filter((r: any) => r.subject_id === subj.subject_id);
      const offering = studentIds.filter((id: string) => !optOuts.has(`${id}:${subj.subject_id}`));
      const counts = { draft: 0, submitted: 0, approved: 0, returned: 0 } as Record<string, number>;
      subjRows.forEach((r: any) => {
        const key = r.status === "published" ? "approved" : r.status;
        counts[key] = (counts[key] || 0) + 1;
      });
      const withRows = new Set(subjRows.map((r: any) => r.student_id));
      return {
        subjectId: subj.subject_id,
        name: subj.subject_name,
        teachers: (assignRes.data || [])
          .filter((a: any) => a.subject_id === subj.subject_id)
          .map((a: any) => nameOf.get(a.teacher_user_id) || "Teacher"),
        counts,
        missing: offering.filter((id: string) => !withRows.has(id)).length,
        notOffering: studentIds.length - offering.length,
        returnReason: subjRows.find((r: any) => r.status === "returned")?.return_reason || null,
        lastUpdated: subjRows.reduce((m: string | null, r: any) => (!m || r.updated_at > m ? r.updated_at : m), null),
      };
    });

    const milestones = await Promise.all(
      MILESTONES.map(async (milestone) => {
        const col = STATUS_COLUMN[milestone];
        const publishedCount = rows.filter((r: any) => r[col] === "published").length;
        const build = await buildClassReports(service, { classId, term, session, milestone });

        let publishedAt: string | null = null;
        const enrollIds = Array.from(build.enrollmentByStudent.values());
        if (publishedCount && enrollIds.length) {
          const { data: snap } = await service
            .from("result_snapshots")
            .select("published_at")
            .eq("term", term)
            .eq("report_type", milestone)
            .in("enrollment_id", enrollIds)
            .order("published_at", { ascending: false })
            .limit(1);
          publishedAt = snap?.[0]?.published_at || null;
        }

        return {
          milestone,
          published: publishedCount > 0,
          publishedAt,
          reportCount: build.reports.length,
          issues: build.issues,
          students: build.reports.map((r) => ({ id: r.student.id, name: r.student.name })),
        };
      })
    );

    return NextResponse.json({ ok: true, term, session, classSize: studentIds.length, grid, milestones });
  } catch (err: any) {
    const missing = /subject_group|student_subject_optouts/i.test(err?.message || "");
    return NextResponse.json({ ok: false, error: missing ? MIGRATION_HINT : err.message }, { status: missing ? 409 : 500 });
  }
}
