import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

// Postgres error codes that just mean "this table/column doesn't exist in this
// database" — safe to ignore since the schema has evolved across migrations and
// not every environment has every legacy/canonical table.
const IGNORABLE_CODES = new Set(["42703", "42P01"]);

function isIgnorable(error: any) {
  return error && IGNORABLE_CODES.has(error.code);
}

/**
 * Deletes every record across the app that links to an academic session, so the
 * session row itself can then be deleted despite its ON DELETE RESTRICT
 * foreign keys. Best-effort per table: a table/column that doesn't exist in
 * this environment is silently skipped rather than aborting the whole cascade.
 */
async function cascadeDeleteSession(service: any, sessionId: string, sessionName: string) {
  const ids = async (table: string, column: string, matchColumn: string, matchValue: string) => {
    try {
      const { data, error } = await service.from(table).select("id").eq(matchColumn, matchValue);
      if (error) {
        if (!isIgnorable(error)) console.warn(`cascadeDeleteSession: could not read ${table}.${column}:`, error.message);
        return [];
      }
      return (data || []).map((row: any) => row.id);
    } catch {
      return [];
    }
  };

  const del = async (table: string, apply: (q: any) => any) => {
    try {
      const { error } = await apply(service.from(table).delete());
      if (error && !isIgnorable(error)) {
        console.warn(`cascadeDeleteSession: could not clear ${table}:`, error.message);
      }
    } catch (err: any) {
      console.warn(`cascadeDeleteSession: unexpected error clearing ${table}:`, err?.message);
    }
  };

  const enrollmentIds = await ids("student_enrollments", "id", "academic_session_id", sessionId);
  const feeStructureIds = await ids("fee_structures", "id", "academic_session_id", sessionId);
  const examIds = await ids("cbt_exams", "id", "academic_session_id", sessionId);
  const admissionFormIds = await ids("admission_forms", "id", "academic_session_id", sessionId);

  let invoiceIds: string[] = [];
  if (enrollmentIds.length || feeStructureIds.length) {
    try {
      let q = service.from("payment_invoices").select("id");
      const orParts: string[] = [];
      if (enrollmentIds.length) orParts.push(`enrollment_id.in.(${enrollmentIds.join(",")})`);
      if (feeStructureIds.length) orParts.push(`fee_structure_id.in.(${feeStructureIds.join(",")})`);
      const { data, error } = await q.or(orParts.join(","));
      if (!error) invoiceIds = (data || []).map((row: any) => row.id);
    } catch {
      // ignore — payment tables may not exist in this environment
    }
  }

  // Deepest leaves first, then work up to the session row itself.
  if (invoiceIds.length) await del("payment_transactions", (q) => q.in("invoice_id", invoiceIds));
  if (invoiceIds.length) await del("payment_invoices", (q) => q.in("id", invoiceIds));
  if (admissionFormIds.length) await del("admission_payments", (q) => q.in("admission_form_id", admissionFormIds));
  if (examIds.length || enrollmentIds.length) {
    await del("cbt_submissions", (q) => {
      const orParts: string[] = [];
      if (examIds.length) orParts.push(`exam_id.in.(${examIds.join(",")})`);
      if (enrollmentIds.length) orParts.push(`enrollment_id.in.(${enrollmentIds.join(",")})`);
      return q.or(orParts.join(","));
    });
  }
  if (examIds.length) await del("cbt_questions", (q) => q.in("exam_id", examIds));
  if (enrollmentIds.length) await del("result_snapshots", (q) => q.in("enrollment_id", enrollmentIds));
  if (enrollmentIds.length) await del("results", (q) => q.in("enrollment_id", enrollmentIds));
  if (enrollmentIds.length) await del("attendance_records", (q) => q.in("enrollment_id", enrollmentIds));

  // Legacy tables keyed by the session's text name rather than its id.
  await del("results", (q) => q.eq("session", sessionName));
  await del("attendance", (q) => q.eq("session", sessionName));
  await del("student_subject_optouts", (q) => q.eq("session", sessionName));

  await del("cbt_exams", (q) => q.eq("academic_session_id", sessionId));
  await del("admission_forms", (q) => q.eq("academic_session_id", sessionId));
  await del("fee_structures", (q) => q.eq("academic_session_id", sessionId));
  await del("promotions", (q) => q.or(`from_session_id.eq.${sessionId},to_session_id.eq.${sessionId}`));
  await del("alumni_students", (q) => q.eq("graduated_session_id", sessionId));
  await del("class_teacher_assignments", (q) => q.eq("academic_session_id", sessionId));
  await del("subject_teacher_assignments", (q) => q.eq("academic_session_id", sessionId));
  await del("academic_terms", (q) => q.eq("academic_session_id", sessionId));
  await del("timetable_slots", (q) => q.eq("academic_session_id", sessionId));
  await del("announcements", (q) => q.eq("academic_session_id", sessionId));
  await del("student_enrollments", (q) => q.eq("academic_session_id", sessionId));
}

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"], { allowLockedStudent: true });
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const [sessionsRes, settingsRes] = await Promise.all([
      service.from("academic_sessions").select("*").order("name", { ascending: true }),
      service.from("app_settings").select("current_session, current_term").limit(1).maybeSingle(),
    ]);

    return NextResponse.json({
      ok: true,
      sessions: sessionsRes.data || [],
      current_session: settingsRes.data?.current_session || "",
      current_term: settingsRes.data?.current_term || "term1",
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const setAsCurrent = Boolean(body.set_as_current);

    if (!name) {
      return NextResponse.json({ ok: false, error: "Session name is required" }, { status: 400 });
    }

    if (setAsCurrent) {
      await service.from("academic_sessions").update({ is_current: false }).neq("name", name);
    }

    const { data: session, error } = await service
      .from("academic_sessions")
      .upsert(
        {
          name,
          status: "active",
          is_current: setAsCurrent,
        },
        { onConflict: "name" }
      )
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    if (setAsCurrent) {
      const { data: existing } = await service.from("app_settings").select("id").limit(1).maybeSingle();
      const id = existing?.id || 1;
      await service.from("app_settings").upsert({ id, current_session: name, current_session_id: session.id });
    }

    return NextResponse.json({ ok: true, session });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const body = await req.json();
    const deleteAll = Boolean(body.all);
    const sessionName = String(body.name || "").trim();

    if (deleteAll) {
      const { data: allSessions } = await service.from("academic_sessions").select("id, name");
      for (const s of allSessions || []) {
        await cascadeDeleteSession(service, s.id, s.name);
      }

      const { error } = await service.from("academic_sessions").delete().neq("name", "__none__");
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

      // Clear current_session in app_settings
      const { data: existing } = await service.from("app_settings").select("id").limit(1).maybeSingle();
      if (existing) {
        await service.from("app_settings").update({ current_session: "", current_session_id: null }).eq("id", existing.id);
      }

      return NextResponse.json({ ok: true, message: "All sessions deleted" });
    }

    if (!sessionName) {
      return NextResponse.json({ ok: false, error: "Session name is required for deletion" }, { status: 400 });
    }

    const { data: sessionRow } = await service.from("academic_sessions").select("id, name").eq("name", sessionName).maybeSingle();
    if (!sessionRow) {
      return NextResponse.json({ ok: false, error: `Session "${sessionName}" was not found` }, { status: 404 });
    }

    await cascadeDeleteSession(service, sessionRow.id, sessionRow.name);

    const { error } = await service.from("academic_sessions").delete().eq("id", sessionRow.id);
    if (error) {
      const detail = error.code === "23503" ? " Some records still reference this session and could not be automatically cleared." : "";
      return NextResponse.json({ ok: false, error: error.message + detail }, { status: 400 });
    }

    // If current_session was deleted, reset it
    const { data: settings } = await service.from("app_settings").select("id, current_session").limit(1).maybeSingle();
    if (settings?.current_session === sessionName) {
      await service.from("app_settings").update({ current_session: "", current_session_id: null }).eq("id", settings.id);
    }

    return NextResponse.json({ ok: true, message: `Session ${sessionName} deleted` });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
