import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { getCurrentSessionAndTerm } from "@/lib/financeServer";
import { isTermCode } from "@/lib/serverContext";
import { PERSONAL_SKILLS, calculateTR, toStoredScores, weeksForFrequency, type RawScores } from "@/lib/gradingEngine";

/**
 * Developer-only sandbox for testing publishing and scratch cards without touching real classes.
 *
 * Every write is limited to classes whose name starts with "ZZ Test", so a typo can never wipe or
 * fill a real class. Real students are never moved by this route: put a test student in the class
 * with Students -> Edit -> Class (that moves their enrollment and scores too).
 *
 * GET                       list test classes with what they hold
 * POST { action: "create" } { name?, subject_group_code? }
 * POST { action: "fill" }   { class_id, term }  approved sample scores, attendance and remarks for the class's students
 * POST { action: "clear" }  { class_id }        delete the sample data (scores, reports, attendance, remarks, cards, badges)
 * POST { action: "delete" } { class_id }        delete an empty test class
 */

const TEST_CLASS_PREFIX = "ZZ Test";
const isTestClassName = (name: unknown): name is string => typeof name === "string" && name.startsWith(TEST_CLASS_PREFIX);

async function authorize(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization;
  if (!(await requireDeveloper(authorization.actor))) {
    return { response: NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 }) };
  }
  return authorization;
}

async function loadTestClass(service: any, classId: unknown) {
  if (!classId || typeof classId !== "string") return { error: NextResponse.json({ ok: false, error: "class_id is required." }, { status: 400 }) };
  const { data } = await service.from("classes").select("id, name, subject_group_code").eq("id", classId).maybeSingle();
  if (!data) return { error: NextResponse.json({ ok: false, error: "Class not found." }, { status: 404 }) };
  if (!isTestClassName(data.name)) {
    return { error: NextResponse.json({ ok: false, error: `Only classes named "${TEST_CLASS_PREFIX}…" can be changed here.` }, { status: 403 }) };
  }
  return { cls: data as { id: string; name: string; subject_group_code: string | null } };
}

/** Small deterministic generator so the sample scores differ per student/subject but are repeatable. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const between = (rand: () => number, lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

export async function GET(req: NextRequest) {
  const authorization = await authorize(req);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const [{ data: classes }, { data: groups }] = await Promise.all([
    service.from("classes").select("id, name, subject_group_code").like("name", `${TEST_CLASS_PREFIX}%`).order("name"),
    service.from("subject_groups").select("code, name").order("code"),
  ]);

  const out = [];
  for (const c of classes || []) {
    const [students, results, enrollments] = await Promise.all([
      service.from("students").select("id, name, admission_no").eq("class_id", c.id),
      service.from("results").select("id", { count: "exact", head: true }).eq("class_id", c.id),
      service.from("student_enrollments").select("id").eq("class_id", c.id),
    ]);
    const enrollmentIds = (enrollments.data || []).map((e: any) => e.id);
    const snapshots = enrollmentIds.length
      ? await service.from("result_snapshots").select("id", { count: "exact", head: true }).in("enrollment_id", enrollmentIds)
      : { count: 0 };
    const studentIds = (students.data || []).map((s: any) => s.id);
    const cards = studentIds.length
      ? await service.from("scratch_cards").select("id", { count: "exact", head: true }).in("student_id", studentIds)
      : { count: 0 };
    out.push({
      id: c.id,
      name: c.name,
      subjectGroup: c.subject_group_code,
      students: (students.data || []).map((s: any) => ({ id: s.id, name: s.name, admissionNo: s.admission_no })),
      results: results.count || 0,
      snapshots: snapshots.count || 0,
      cards: cards.count || 0,
    });
  }
  return NextResponse.json({ ok: true, classes: out, groups: groups || [], prefix: TEST_CLASS_PREFIX });
}

export async function POST(req: NextRequest) {
  const authorization = await authorize(req);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const { service, dbUserId } = actor;

  const body = await req.json().catch(() => null);
  const action = String(body?.action || "");

  if (action === "create") {
    const name = String(body?.name || `${TEST_CLASS_PREFIX} Class`).trim();
    if (!isTestClassName(name)) {
      return NextResponse.json({ ok: false, error: `A test class name must start with "${TEST_CLASS_PREFIX}".` }, { status: 400 });
    }
    const groupCode = String(body?.subject_group_code || "JSS");
    const { data: group } = await service.from("subject_groups").select("code").eq("code", groupCode).maybeSingle();
    if (!group) return NextResponse.json({ ok: false, error: "That subject list does not exist." }, { status: 400 });
    const { data: existing } = await service.from("classes").select("id").eq("name", name).maybeSingle();
    if (existing) return NextResponse.json({ ok: false, error: `A class named "${name}" already exists.` }, { status: 409 });

    const { data: created, error } = await service
      .from("classes")
      .insert({ name, level: groupCode.startsWith("SSS") ? "senior" : "junior", display_order: 99, subject_group_code: groupCode })
      .select("id, name")
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await logAudit(actor, { action: "dev_tools.test_class_create", entityType: "class", entityId: created.id, summary: `Created test class "${created.name}" (${groupCode} subjects)` });
    return NextResponse.json({ ok: true, class: created });
  }

  const loaded = await loadTestClass(service, body?.class_id);
  if ("error" in loaded) return loaded.error;
  const { cls } = loaded;

  if (action === "fill") {
    const term = String(body?.term || "");
    if (!isTermCode(term)) return NextResponse.json({ ok: false, error: "A valid term is required." }, { status: 400 });
    if (!cls.subject_group_code) return NextResponse.json({ ok: false, error: "This class has no subject list." }, { status: 400 });

    const { sessionId, session } = await getCurrentSessionAndTerm(service);
    if (!sessionId) return NextResponse.json({ ok: false, error: "No current session is set." }, { status: 400 });

    const { data: enrollments } = await service
      .from("student_enrollments")
      .select("id, student_id, students(name)")
      .eq("academic_session_id", sessionId)
      .eq("class_id", cls.id);
    if (!enrollments?.length) {
      return NextResponse.json({ ok: false, error: "No students are in this class yet. Move a test student in with Students → Edit → Class." }, { status: 400 });
    }

    const { data: subjectRows } = await service
      .from("subject_group_subjects")
      .select("subject_id, frequency")
      .eq("group_code", cls.subject_group_code);
    if (!subjectRows?.length) return NextResponse.json({ ok: false, error: "This class's subject list is empty." }, { status: 400 });

    const isSenior = cls.subject_group_code.startsWith("SSS");
    const rows: any[] = [];
    for (const e of enrollments as any[]) {
      for (const sub of subjectRows as any[]) {
        const rand = seeded(`${e.student_id}:${sub.subject_id}:${term}`);
        const c = between(rand, 7, 10);
        const h = between(rand, 7, 10);
        const raw: RawScores = {
          cw: Array(10).fill(String(c)),
          hw: Array(10).fill(String(h)),
          tests: [String(between(rand, 10, 15)), String(between(rand, 10, 15)), String(between(rand, 18, 30))],
          project: String(between(rand, 3, 5)),
          exam: String(between(rand, 45, 68)),
        };
        const { total: _generated, ...stored } = toStoredScores(calculateTR(raw, { isSenior, weeks: weeksForFrequency(sub.frequency) }), raw);
        rows.push({
          enrollment_id: e.id,
          student_id: e.student_id,
          class_id: cls.id,
          academic_session_id: sessionId,
          session,
          subject_id: sub.subject_id,
          term,
          ...stored,
          status: "approved",
          approved_by: dbUserId ?? null,
        });
      }
    }

    // ignoreDuplicates: a score that already exists (real or earlier sample) is never overwritten.
    const { data: inserted, error } = await service
      .from("results")
      .upsert(rows, { onConflict: "enrollment_id,subject_id,term", ignoreDuplicates: true })
      .select("id");
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const skills = Object.fromEntries(PERSONAL_SKILLS.map((k) => [k.key, 4]));
    for (const e of enrollments as any[]) {
      const rand = seeded(`${e.student_id}:${term}:att`);
      const present = between(rand, 100, 118);
      await service
        .from("attendance_summaries")
        .upsert({ enrollment_id: e.id, term, times_opened: 120, times_present: present, times_absent: 120 - present }, { onConflict: "enrollment_id,term", ignoreDuplicates: true });
      await service.from("student_evaluations").upsert(
        {
          enrollment_id: e.id,
          term,
          teacher_remark: "TEST STUDENT: A hardworking and well-behaved student.",
          principal_remark: "TEST STUDENT: Keep up the good work.",
          evaluated_by: dbUserId ?? null,
          skills,
        },
        { onConflict: "enrollment_id,term", ignoreDuplicates: true }
      );
    }

    const created = (inserted || []).length;
    await logAudit(actor, {
      action: "dev_tools.test_class_fill",
      entityType: "class",
      entityId: cls.id,
      summary: `Filled sample ${term} scores for ${enrollments.length} student(s) in "${cls.name}": ${created} score row(s) added`,
      metadata: { term, students: enrollments.length, rowsAdded: created },
    });
    return NextResponse.json({ ok: true, students: enrollments.length, subjects: subjectRows.length, rowsAdded: created });
  }

  if (action === "clear") {
    const [{ data: students }, { data: enrollments }] = await Promise.all([
      service.from("students").select("id").eq("class_id", cls.id),
      service.from("student_enrollments").select("id").eq("class_id", cls.id),
    ]);
    const studentIds = (students || []).map((s: any) => s.id);
    const enrollmentIds = (enrollments || []).map((e: any) => e.id);

    const count = async (q: PromiseLike<{ data: any[] | null; error: any }>) => {
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).length;
    };
    try {
      const snapshots = enrollmentIds.length ? await count(service.from("result_snapshots").delete().in("enrollment_id", enrollmentIds).select("id")) : 0;
      const results = await count(service.from("results").delete().eq("class_id", cls.id).select("id"));
      const attendance = enrollmentIds.length ? await count(service.from("attendance_summaries").delete().in("enrollment_id", enrollmentIds).select("id")) : 0;
      const remarks = enrollmentIds.length ? await count(service.from("student_evaluations").delete().in("enrollment_id", enrollmentIds).select("id")) : 0;
      const cards = studentIds.length ? await count(service.from("scratch_cards").delete().in("student_id", studentIds).select("id")) : 0;
      if (studentIds.length) {
        await service.from("scratch_card_purchases").delete().in("student_id", studentIds);
        await service.from("scratch_card_failures").delete().in("student_id", studentIds);
        await service.from("student_badges").delete().in("student_id", studentIds);
      }
      await logAudit(actor, {
        action: "dev_tools.test_class_clear",
        entityType: "class",
        entityId: cls.id,
        summary: `Cleared test data in "${cls.name}": ${results} score(s), ${snapshots} report(s), ${cards} card(s)`,
        metadata: { results, snapshots, attendance, remarks, cards },
      });
      return NextResponse.json({ ok: true, results, snapshots, attendance, remarks, cards });
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: err?.message || "Could not clear the test data." }, { status: 500 });
    }
  }

  if (action === "delete") {
    const [students, enrollments, results] = await Promise.all([
      service.from("students").select("id", { count: "exact", head: true }).eq("class_id", cls.id),
      service.from("student_enrollments").select("id", { count: "exact", head: true }).eq("class_id", cls.id),
      service.from("results").select("id", { count: "exact", head: true }).eq("class_id", cls.id),
    ]);
    if ((students.count || 0) + (enrollments.count || 0) + (results.count || 0) > 0) {
      return NextResponse.json(
        { ok: false, error: "This class still has students, enrollments or scores. Clear the test data, then move the students back to their real class (Students → Edit → Class)." },
        { status: 409 }
      );
    }
    const { error } = await service.from("classes").delete().eq("id", cls.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await logAudit(actor, { action: "dev_tools.test_class_delete", entityType: "class", entityId: cls.id, summary: `Deleted test class "${cls.name}"` });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
