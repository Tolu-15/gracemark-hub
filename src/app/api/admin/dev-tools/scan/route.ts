import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";

export interface ScanIssue {
  type: "duplicate_admission_no" | "orphaned_account" | "email_drift" | "duplicate_email";
  severity: "high" | "medium";
  summary: string;
  details: Record<string, any>;
}

function deriveEmail(admissionNo: string) {
  return `${admissionNo.trim().replace(/[^A-Z0-9]/gi, "").toLowerCase()}@student.gracemark.edu.ng`;
}

/**
 * GET — the same checks run by hand throughout this project's history:
 * duplicate admission numbers, logins with no student/teacher attached,
 * and the admission-number/login-email drift that once let one student's
 * login get silently reassigned to another. Read-only.
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!(await requireDeveloper(actor))) return NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 });
  const { service } = actor;

  const issues: ScanIssue[] = [];

  const [{ data: students }, { data: users }] = await Promise.all([
    service.from("students").select("id, name, full_name, admission_no, user_id"),
    service.from("users").select("id, auth_id, email, display_name, role"),
  ]);

  const studentList = students || [];
  const userList = users || [];
  const userById = new Map(userList.map((u: any) => [u.id, u]));

  // 1. Duplicate admission numbers
  const byAdm = new Map<string, any[]>();
  studentList.forEach((s: any) => {
    const key = String(s.admission_no || "").trim().toUpperCase();
    if (!key) return;
    (byAdm.get(key) || byAdm.set(key, []).get(key)!).push(s);
  });
  byAdm.forEach((rows, adm) => {
    if (rows.length > 1) {
      issues.push({
        type: "duplicate_admission_no",
        severity: "high",
        summary: `${adm} is used by ${rows.length} students`,
        details: { admission_no: adm, students: rows.map((r: any) => ({ id: r.id, name: r.full_name || r.name })) },
      });
    }
  });

  // 2. Orphaned login accounts: a student-role user with no student row pointing at it
  const claimedUserIds = new Set(studentList.map((s: any) => s.user_id).filter(Boolean));
  userList
    .filter((u: any) => u.role === "student" && !claimedUserIds.has(u.id))
    .forEach((u: any) => {
      issues.push({
        type: "orphaned_account",
        severity: "medium",
        summary: `Login for "${u.display_name}" (${u.email}) has no student record attached`,
        details: { user_id: u.id, email: u.email, display_name: u.display_name },
      });
    });

  // 3. Admission number / login email drift (the Patricia bug)
  studentList.forEach((s: any) => {
    const user = userById.get(s.user_id);
    if (!user?.email) return;
    const expected = deriveEmail(s.admission_no || "");
    const current = String(user.email).toLowerCase();
    // Only flag auto-generated-style emails that have drifted — never touch a
    // deliberately customized real email address.
    if (current.endsWith("@student.gracemark.edu.ng") && current !== expected) {
      issues.push({
        type: "email_drift",
        severity: "high",
        summary: `${s.full_name || s.name} (${s.admission_no}) logs in with ${current}, but that doesn't match their admission number`,
        details: { student_id: s.id, name: s.full_name || s.name, admission_no: s.admission_no, current_email: current, expected_email: expected },
      });
    }
  });

  // 4. Duplicate emails across different accounts (should be impossible, cheap sanity check)
  const byEmail = new Map<string, any[]>();
  userList.forEach((u: any) => {
    if (!u.email) return;
    const key = u.email.toLowerCase();
    (byEmail.get(key) || byEmail.set(key, []).get(key)!).push(u);
  });
  byEmail.forEach((rows, email) => {
    if (rows.length > 1) {
      issues.push({
        type: "duplicate_email",
        severity: "high",
        summary: `${email} is shared by ${rows.length} login accounts`,
        details: { email, accounts: rows.map((r: any) => ({ id: r.id, display_name: r.display_name, role: r.role })) },
      });
    }
  });

  return NextResponse.json({ ok: true, issueCount: issues.length, issues, scannedAt: new Date().toISOString() });
}
