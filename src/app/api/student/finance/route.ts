import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { buildStudentFinance, evaluatePortalAccess, findStudentForActor, getStudentHistory } from "@/lib/financeServer";

/**
 * GET /api/student/finance?student_id=…[&evaluate=1]
 * Returns the student's current invoice (creating / syncing it server-side) or, with
 * evaluate=1, applies the fee-lock policy. Students can only ask about themselves.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["student", "admin"], { allowLockedStudent: true });
  if ("response" in authorization) return authorization.response;
  const { service, role, authId, dbUserId } = authorization.actor;

  const { searchParams } = new URL(req.url);
  let studentId = searchParams.get("student_id") || "";

  try {
    if (role === "student") {
      const own = await findStudentForActor(service, authId, dbUserId);
      if (!own || (studentId && studentId !== own.id)) {
        return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
      }
      studentId = own.id;
    }
    if (!studentId) return NextResponse.json({ ok: false, error: "student_id is required." }, { status: 400 });

    if (searchParams.get("history")) {
      return NextResponse.json({ ok: true, ...(await getStudentHistory(service, studentId)) });
    }
    if (searchParams.get("evaluate")) {
      return NextResponse.json({ ok: true, ...(await evaluatePortalAccess(service, studentId)) });
    }
    return NextResponse.json({ ok: true, finance: await buildStudentFinance(service, studentId) });
  } catch (err: any) {
    console.error("GET /api/student/finance error:", err);
    return NextResponse.json({ ok: false, error: "Could not load finance data." }, { status: 500 });
  }
}
