import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { calculateGPA, getGradeAndRemark, rankPositions } from "@/lib/gradingEngine";
import { buildClassReports, Milestone, MILESTONES, promotionFor, StudentReport } from "@/lib/reportBuilder";
import { getClassSubjects } from "@/lib/subjectGroups";

export const dynamic = "force-dynamic";

function gradeCounts(grades: string[]) {
  const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  grades.forEach((g) => {
    if (g in counts) counts[g] += 1;
  });
  return counts;
}

function stats(values: number[]) {
  if (!values.length) return { avg: null, highest: null, lowest: null, count: 0 };
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    avg: round1(values.reduce((a, b) => a + b, 0) / values.length),
    highest: round1(Math.max(...values)),
    lowest: round1(Math.min(...values)),
    count: values.length,
  };
}

/** Same as stats(), but also names who scored the highest/lowest (ties: all of them). */
function statsWithNames(pairs: { name: string; value: number }[]) {
  const base = stats(pairs.map((p) => p.value));
  if (!pairs.length) return { ...base, highestNames: [] as string[], lowestNames: [] as string[] };
  const max = Math.max(...pairs.map((p) => p.value));
  const min = Math.min(...pairs.map((p) => p.value));
  return {
    ...base,
    highestNames: pairs.filter((p) => p.value === max).map((p) => p.name),
    lowestNames: pairs.filter((p) => p.value === min).map((p) => p.name),
  };
}

/**
 * GET ?classId=&session=&term=term1|term2|term3|annual&milestone=PR1|PR2|PR3|TR
 * Class master broadsheet built with the same engine as the report cards
 * (live scores, whether or not they are published).
 */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  const sp = req.nextUrl.searchParams;
  const classId = sp.get("classId") || "";
  const session = (sp.get("session") || "").trim();
  const term = sp.get("term") || "term1";
  const milestone = (sp.get("milestone") || "TR") as Milestone;
  if (!classId || !session) return NextResponse.json({ ok: false, error: "classId and session are required." }, { status: 400 });
  if (!MILESTONES.includes(milestone)) return NextResponse.json({ ok: false, error: "Invalid milestone." }, { status: 400 });

  try {
    const classSubjects = await getClassSubjects(service, classId);
    const subjects = classSubjects.map((s) => ({ id: s.subject_id, name: s.subject_name, creditUnit: s.credit_unit }));

    // ---------------- Term broadsheet (PR1 / PR2 / PR3 / TR) ----------------
    if (term !== "annual") {
      const build = await buildClassReports(service, { classId, term, session, milestone });
      const isTR = milestone === "TR";
      const reports = build.reports;
      const isSenior = reports[0]?.isSenior ?? false;

      const subjectStats: Record<string, any> = {};
      subjects.forEach((sub) => {
        const pairs = reports
          .map((r) => {
            const line = r.subjects.find((l) => l.subjectId === sub.id);
            return line ? { name: r.student.name, value: isTR ? line.total : line.percentage || 0, grade: line.grade } : null;
          })
          .filter((p): p is { name: string; value: number; grade: string } => p !== null);
        subjectStats[sub.id] = {
          ...statsWithNames(pairs),
          grades: gradeCounts(pairs.map((p) => p.grade)),
          passes: pairs.filter((p) => p.grade !== "F").length,
        };
      });

      const averages = reports.map((r) => r.summary.percentage);
      const rows = [...reports]
        .sort((a, b) =>
          isTR && a.summary.position && b.summary.position
            ? a.summary.position - b.summary.position
            : b.summary.percentage - a.summary.percentage
        )
        .map((r) => ({
          studentId: r.student.id,
          name: r.student.name,
          admissionNo: r.student.admissionNo,
          lines: Object.fromEntries(r.subjects.map((l) => [l.subjectId, l])),
          subjectsTaken: r.subjects.length,
          total: r.summary.total,
          average: r.summary.percentage,
          grade: r.summary.grade,
          remark: r.summary.remark,
          gpa: r.summary.gpa,
          position: r.summary.position,
          attendance: r.attendance,
          skillsTotal: r.skillsTotal,
        }));

      // PR positions (not on PR report cards, but useful on the broadsheet)
      if (!isTR) {
        const pos = rankPositions(rows.map((r) => ({ id: r.studentId, value: r.average })));
        rows.forEach((r) => (r.position = pos.get(r.studentId) ?? null));
      }

      return NextResponse.json({
        ok: true,
        mode: "term",
        className: build.className,
        isSenior,
        session,
        term,
        milestone,
        classSize: reports[0]?.classSize ?? 0,
        subjects,
        rows,
        subjectStats,
        classSummary: {
          evaluated: reports.length,
          ...stats(averages),
          grades: gradeCounts(reports.map((r) => r.summary.grade)),
        },
        issues: build.issues,
      });
    }

    // ---------------- Annual broadsheet (1st + 2nd + 3rd term) ----------------
    const builds = await Promise.all(
      (["term1", "term2", "term3"] as const).map((t) => buildClassReports(service, { classId, term: t, session, milestone: "TR" }))
    );
    const isSenior = builds.find((b) => b.reports.length)?.reports[0]?.isSenior ?? false;
    const className = builds[0].className;

    const byStudent = new Map<string, { name: string; admissionNo: string; terms: (StudentReport | null)[] }>();
    builds.forEach((b, i) =>
      b.reports.forEach((r) => {
        const entry = byStudent.get(r.student.id) || { name: r.student.name, admissionNo: r.student.admissionNo, terms: [null, null, null] };
        entry.terms[i] = r;
        byStudent.set(r.student.id, entry);
      })
    );

    const rows = Array.from(byStudent.entries()).map(([studentId, e]) => {
      const perSubject: Record<string, any> = {};
      subjects.forEach((sub) => {
        const totals = e.terms.map((r) => r?.subjects.find((l) => l.subjectId === sub.id)?.total ?? null);
        const present = totals.filter((v): v is number => v !== null);
        if (!present.length) return;
        const annual = Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 100) / 100;
        const { grade, remark } = getGradeAndRemark(annual, isSenior);
        perSubject[sub.id] = { term1: totals[0], term2: totals[1], term3: totals[2], annual, grade, remark };
      });
      const annuals = Object.entries(perSubject).map(([id, v]: any) => ({
        total: v.annual as number,
        creditUnit: subjects.find((s) => s.id === id)?.creditUnit ?? 0,
      }));
      const annualTotal = Math.round(annuals.reduce((a, b) => a + b.total, 0) * 100) / 100;
      const average = annuals.length ? Math.round((annualTotal / annuals.length) * 100) / 100 : 0;
      const { grade, remark } = getGradeAndRemark(average, isSenior);
      return {
        studentId,
        name: e.name,
        admissionNo: e.admissionNo,
        perSubject,
        subjectsTaken: annuals.length,
        termAverages: e.terms.map((r) => r?.summary.percentage ?? null),
        annualTotal,
        average,
        gpa: calculateGPA(annuals),
        grade,
        remark,
        position: null as number | null,
        promotion: promotionFor(className, isSenior, average),
      };
    });

    const pos = rankPositions(rows.map((r) => ({ id: r.studentId, value: isSenior ? r.gpa : r.average })));
    rows.forEach((r) => (r.position = pos.get(r.studentId) ?? null));
    rows.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

    const subjectStats: Record<string, any> = {};
    subjects.forEach((sub) => {
      const vals = rows.map((r) => (r.perSubject[sub.id] ? { ...r.perSubject[sub.id], name: r.name } : null)).filter(Boolean) as any[];
      subjectStats[sub.id] = {
        ...statsWithNames(vals.map((v) => ({ name: v.name, value: v.annual }))),
        grades: gradeCounts(vals.map((v) => v.grade)),
        passes: vals.filter((v) => v.grade !== "F").length,
      };
    });

    return NextResponse.json({
      ok: true,
      mode: "annual",
      className,
      isSenior,
      session,
      term,
      milestone: "TR",
      classSize: Math.max(...builds.map((b) => b.reports[0]?.classSize ?? 0), 0),
      subjects,
      rows,
      subjectStats,
      classSummary: {
        evaluated: rows.length,
        ...stats(rows.map((r) => r.average)),
        grades: gradeCounts(rows.map((r) => r.grade)),
        promotion: {
          PROMOTED: rows.filter((r) => r.promotion?.status === "PROMOTED").length,
          TRIAL: rows.filter((r) => r.promotion?.status === "TRIAL").length,
          REPEAT: rows.filter((r) => r.promotion?.status === "REPEAT").length,
        },
      },
      issues: [],
    });
  } catch (err: any) {
    console.error("Class broadsheet error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

