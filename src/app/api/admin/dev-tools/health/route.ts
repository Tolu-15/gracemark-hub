import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";

/** GET — operational counts: logins, pending work, push coverage. Read-only. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!(await requireDeveloper(actor))) return NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 });
  const { service } = actor;

  const [
    { count: studentCount },
    { count: teacherCount },
    { count: adminCount },
    { data: students },
    { count: submittedCount },
    { count: returnedCount },
    { count: pushSubCount },
  ] = await Promise.all([
    service.from("students").select("id", { count: "exact", head: true }),
    service.from("users").select("id", { count: "exact", head: true }).eq("role", "teacher"),
    service.from("users").select("id", { count: "exact", head: true }).eq("role", "admin"),
    service.from("students").select("id, user_id"),
    service.from("results").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    service.from("results").select("id", { count: "exact", head: true }).eq("status", "returned"),
    service.from("push_subscriptions").select("user_id", { count: "exact", head: true }),
  ]);

  const studentsWithoutLogin = (students || []).filter((s: any) => !s.user_id).length;

  const { data: pushUserRows } = await service.from("push_subscriptions").select("user_id");
  const distinctPushUsers = new Set((pushUserRows || []).map((r: any) => r.user_id)).size;
  const staffCount = (teacherCount || 0) + (adminCount || 0);

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    students: { total: studentCount || 0, withoutLogin: studentsWithoutLogin },
    staff: { teachers: teacherCount || 0, admins: adminCount || 0 },
    approvals: { pendingReview: submittedCount || 0, returnedForCorrection: returnedCount || 0 },
    push: { subscriptions: pushSubCount || 0, distinctUsersSubscribed: distinctPushUsers, totalStaffAndStudents: (studentCount || 0) + staffCount },
  });
}
