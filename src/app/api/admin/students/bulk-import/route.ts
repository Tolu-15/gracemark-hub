import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

interface ImportRow {
  name: string;
  admission_no: string;
  class_id: string;
  gender: "male" | "female";
}

const DEFAULT_PASSWORD = "gracemark";

/** Same login email pattern as "Add Student". */
function studentEmail(admissionNo: string) {
  return `${admissionNo.replace(/[^A-Z0-9]/gi, "").toLowerCase()}@student.gracemark.edu.ng`;
}

/**
 * POST { rows: ImportRow[] }
 * Existing students (matched by admission number) are updated: name, class, gender.
 * New students get a portal login (default password "gracemark", like Add Student)
 * and a student record. Each row succeeds or fails on its own.
 */
export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const rows: ImportRow[] = Array.isArray(body?.rows) ? body.rows : [];
  if (!rows.length) return NextResponse.json({ ok: false, error: "No rows to import." }, { status: 400 });
  if (rows.length > 500) return NextResponse.json({ ok: false, error: "Import at most 500 students at a time." }, { status: 400 });

  const { data: existing, error: exErr } = await service.from("students").select("id, admission_no");
  if (exErr) return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 });
  const byAdmission = new Map((existing || []).map((s: any) => [String(s.admission_no).trim().toLowerCase(), s.id]));

  // Auth accounts, fetched once, so re-running an import reuses logins instead of failing
  const authByEmail = new Map<string, string>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    data.users.forEach((u: any) => u.email && authByEmail.set(u.email.toLowerCase(), u.id));
    if (data.users.length < 1000) break;
  }

  const created: string[] = [];
  const updated: string[] = [];
  const failed: { row: string; reason: string }[] = [];

  for (const r of rows) {
    const name = String(r.name || "").trim();
    const admissionNo = String(r.admission_no || "").trim();
    const label = `${name || "?"} (${admissionNo || "no admission no"})`;
    if (!name || !admissionNo || !r.class_id || !["male", "female"].includes(r.gender)) {
      failed.push({ row: label, reason: "Missing name, admission number, class or gender." });
      continue;
    }

    const studentId = byAdmission.get(admissionNo.toLowerCase());
    if (studentId) {
      const { error } = await service
        .from("students")
        .update({ full_name: name, name, class_id: r.class_id, current_class_id: r.class_id, gender: r.gender })
        .eq("id", studentId);
      if (error) failed.push({ row: label, reason: error.message });
      else updated.push(label);
      continue;
    }

    try {
      const email = studentEmail(admissionNo);
      let authId = authByEmail.get(email);
      if (!authId) {
        const { data, error } = await service.auth.admin.createUser({
          email,
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: { display_name: name, role: "student" },
        });
        if (error || !data?.user?.id) throw new Error(error?.message || "Could not create the login.");
        authId = data.user.id;
        authByEmail.set(email, authId);
      }

      const { data: userRow, error: userErr } = await service
        .from("users")
        .upsert(
          { auth_id: authId, email, display_name: name, role: "student", status: "active", must_change_password: true },
          { onConflict: "auth_id" }
        )
        .select("id")
        .single();
      if (userErr || !userRow?.id) throw new Error(userErr?.message || "Could not create the user profile.");

      const { data: inserted, error: insErr } = await service
        .from("students")
        .insert({
          full_name: name,
          name,
          admission_no: admissionNo,
          class_id: r.class_id,
          current_class_id: r.class_id,
          user_id: userRow.id,
          gender: r.gender,
          portal_access_status: "active",
        })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);

      byAdmission.set(admissionNo.toLowerCase(), inserted.id);
      created.push(label);
    } catch (err: any) {
      failed.push({ row: label, reason: err.message || "Unknown error." });
    }
  }

  return NextResponse.json({ ok: true, created, updated, failed, defaultPassword: DEFAULT_PASSWORD });
}
