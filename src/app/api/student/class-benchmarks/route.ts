import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"]);
  if ("response" in authorization) return authorization.response;
  const { service: client } = authorization.actor;

  const searchParams = req.nextUrl.searchParams;
  const classId = searchParams.get("class_id");
  const term = searchParams.get("term") || "term1";
  const session = searchParams.get("session") || "";
  const studentId = searchParams.get("student_id") || "";

  if (!classId) {
    return NextResponse.json({ error: "class_id is required" }, { status: 400 });
  }

  // 1. Fetch all students in this class
  const { data: students, error: sErr } = await client
    .from("students")
    .select("id, name, admission_no")
    .eq("class_id", classId);

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  const allStudents = students || [];
  const classSize = allStudents.length;
  const studentIds = allStudents.map((s) => s.id);

  if (!studentIds.length) {
    return NextResponse.json({
      ok: true,
      classSize: 0,
      position: 1,
      subjectBenchmarks: {},
    });
  }

  // 2. Fetch results for this class cohort in this term & session
  let query = client
    .from("results")
    .select("student_id, subject_id, total, status, subjects(name)")
    .in("student_id", studentIds)
    .eq("term", term)
    .in("status", ["approved", "published", "submitted"]);

  if (session) {
    query = query.eq("session", session);
  }

  const { data: results, error: rErr } = await query;
  if (rErr) {
    return NextResponse.json({ error: rErr.message }, { status: 500 });
  }

  const allResults = results || [];

  // 3. Compute subject benchmarks (class avg, lowest, highest)
  const bySubject: Record<string, { name?: string; scores: number[] }> = {};
  allResults.forEach((r: any) => {
    if (!r.subject_id) return;
    if (!bySubject[r.subject_id]) {
      bySubject[r.subject_id] = { name: r.subjects?.name, scores: [] };
    }
    bySubject[r.subject_id].scores.push(Number(r.total) || 0);
  });

  const subjectBenchmarks: Record<
    string,
    { avg: number; lowest: number; highest: number; count: number }
  > = {};
  for (const [subjId, info] of Object.entries(bySubject)) {
    const scores = info.scores;
    if (!scores.length) continue;
    const sum = scores.reduce((a, b) => a + b, 0);
    const avg = +(sum / scores.length).toFixed(1);
    const lowest = Math.min(...scores);
    const highest = Math.max(...scores);
    subjectBenchmarks[subjId] = {
      avg,
      lowest,
      highest,
      count: scores.length,
    };
  }

  // 4. Compute student position in class
  const totalsByStudent = new Map<string, number>();
  studentIds.forEach((id) => totalsByStudent.set(id, 0));
  allResults.forEach((r: any) => {
    const t = Number(r.total) || 0;
    totalsByStudent.set(r.student_id, (totalsByStudent.get(r.student_id) || 0) + t);
  });

  const sorted = [...totalsByStudent.entries()].sort((a, b) => b[1] - a[1]);
  let position = 1;
  if (studentId) {
    const myTotal = totalsByStudent.get(studentId) || 0;
    let rank = 1;
    for (const [, total] of sorted) {
      if (total > myTotal) rank += 1;
    }
    position = rank;
  }

  return NextResponse.json({
    ok: true,
    classSize,
    position,
    subjectBenchmarks,
  });
}
