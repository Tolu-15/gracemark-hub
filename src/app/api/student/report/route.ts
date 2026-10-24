import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import {
  CARD_PRICE_NAIRA,
  CARD_VIEWS_ALLOWED,
  getCardState,
  onlineCardSalesEnabled,
  recoverPendingPurchases,
} from "@/lib/scratchCards";

/**
 * GET ?session=&term=   (admins may add &student_id=)
 * Returns ONLY published (frozen) reports: the snapshots saved when the admin
 * published each milestone. Nothing is computed from live scores here.
 *
 * The Terminal Result (TR) is never returned to a student here: it needs a scratch card and is
 * served by /api/student/scratch-card/view. Students get `tr` instead, describing whether a TR
 * is published and the state of their card. Admins still see TR for previewing.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student", "admin"]);
  if ("response" in authorization) return authorization.response;
  const { service, role, authId, dbUserId } = authorization.actor;
  const sp = req.nextUrl.searchParams;

  let studentQuery = service.from("students").select("id, name, admission_no, class_id, classes:class_id(name)");
  if (role === "admin") {
    const studentId = sp.get("student_id");
    if (!studentId) return NextResponse.json({ ok: false, error: "student_id is required." }, { status: 400 });
    studentQuery = studentQuery.eq("id", studentId);
  } else {
    studentQuery = studentQuery.in("user_id", [authId, dbUserId].filter(Boolean) as string[]);
  }
  const { data: student, error: stErr } = await studentQuery.maybeSingle();
  if (stErr) return NextResponse.json({ ok: false, error: stErr.message }, { status: 500 });
  if (!student) return NextResponse.json({ ok: false, error: "Student record not found. Please contact the school." }, { status: 404 });

  const [{ data: enrollments }, { data: settings }] = await Promise.all([
    service
      .from("student_enrollments")
      .select("id, academic_session_id, academic_sessions(name, start_date)")
      .eq("student_id", student.id),
    service.from("app_settings").select("current_session, current_term").limit(1).maybeSingle(),
  ]);

  const sessions = (enrollments || [])
    .map((e: any) => ({
      enrollmentId: e.id,
      sessionId: e.academic_session_id as string,
      name: e.academic_sessions?.name as string,
      start: e.academic_sessions?.start_date || "",
    }))
    .filter((s) => s.name)
    .sort((a, b) => (a.start || a.name).localeCompare(b.start || b.name));

  const session = sp.get("session") || settings?.current_session || sessions[sessions.length - 1]?.name || "";
  const term = sp.get("term") || settings?.current_term || "term1";
  const enrollment = sessions.find((s) => s.name === session);

  const reports: Record<string, any> = { PR1: null, PR2: null, PR3: null, TR: null };
  const availableTerms: Record<string, string[]> = {};

  if (enrollment) {
    const { data: snaps, error } = await service
      .from("result_snapshots")
      .select("term, report_type, snapshot_data, published_at")
      .eq("enrollment_id", enrollment.enrollmentId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    (snaps || []).forEach((s: any) => {
      (availableTerms[s.term] ||= []).push(s.report_type);
      if (s.report_type === "TR" && role !== "admin") return; // TR only through a scratch card view
      if (s.term === term) reports[s.report_type] = { ...s.snapshot_data, publishedAt: s.published_at };
    });
  }

  let tr: Record<string, any> | null = null;
  if (role !== "admin") {
    const published = Boolean(enrollment && (availableTerms[term] || []).includes("TR"));
    tr = { published };
    if (published && enrollment) {
      await recoverPendingPurchases(service, student.id);
      tr.card = await getCardState(service, student.id, enrollment.sessionId, term);
      tr.price = CARD_PRICE_NAIRA;
      tr.viewsAllowed = CARD_VIEWS_ALLOWED;
      tr.onlineEnabled = onlineCardSalesEnabled();
    }
  }

  return NextResponse.json({
    ok: true,
    student: {
      id: student.id,
      name: student.name,
      admissionNo: student.admission_no,
      className: (student as any).classes?.name || "",
    },
    sessions: sessions.map((s) => s.name),
    session,
    term,
    reports,
    availableTerms,
    tr,
  });
}
