/**
 * Server-side report builder shared by publishing, preview and the
 * readiness check. Builds one report per student for a class, term and
 * milestone (PR1, PR2, PR3 or TR) following the school's Excel sheets.
 */
import {
  calculateGPA,
  calculatePR1,
  calculatePR2,
  calculatePR3,
  calculateTR,
  emptyScheduledWeeks,
  getGradeAndRemark,
  isSeniorClass,
  normalizeBreakdown,
  principalRemark,
  rankPositions,
  PERSONAL_SKILLS,
  PR_WINDOWS,
  weeksForFrequency,
  AssessmentWeeks,
  PRResult,
  RawScores,
} from "./gradingEngine";
import { getClassSubjects, getOptOuts } from "./subjectGroups";

export type Milestone = "PR1" | "PR2" | "PR3" | "TR";
export const MILESTONES: Milestone[] = ["PR1", "PR2", "PR3", "TR"];
export type TermCode = "term1" | "term2" | "term3";

export const TERM_LABELS: Record<string, string> = {
  term1: "First Term",
  term2: "Second Term",
  term3: "Third Term",
};

export const MILESTONE_LABELS: Record<Milestone, string> = {
  PR1: "Progress Report 1 (Weeks 1 – 4)",
  PR2: "Progress Report 2 (Weeks 1 – 6)",
  PR3: "Progress Report 3 (Weeks 1 – 10)",
  TR: "Terminal Result",
};

export const STATUS_COLUMN: Record<Milestone, "pr1_status" | "pr2_status" | "pr3_status" | "tr_status"> = {
  PR1: "pr1_status",
  PR2: "pr2_status",
  PR3: "pr3_status",
  TR: "tr_status",
};

export interface SubjectLine {
  subjectId: string;
  name: string;
  creditUnit: number;
  cw: number;
  hw: number;
  test: number;
  project: number | null;
  exam: number | null;
  /** PR: total CA out of 30. TR: total out of 100. */
  total: number;
  /** PR only: CA × 10 ÷ 3 */
  percentage: number | null;
  grade: string;
  remark: string;
  classAverage: number | null;
  lowest: number | null;
  highest: number | null;
  /** Third term TR only */
  term1: number | null;
  term2: number | null;
  annualAverage: number | null;
}

export interface StudentReport {
  version: 1;
  milestone: Milestone;
  milestoneLabel: string;
  term: string;
  termLabel: string;
  session: string;
  classId: string;
  className: string;
  isSenior: boolean;
  classSize: number;
  student: { id: string; name: string; admissionNo: string };
  subjects: SubjectLine[];
  summary: {
    total: number;
    percentage: number;
    grade: string;
    remark: string;
    gpa: number | null;
    position: number | null;
    rankedCount: number | null;
    principalRemark: string | null;
  };
  attendance: { opened: number; present: number; absent: number } | null;
  skills: { key: string; label: string; score: number | null }[] | null;
  skillsTotal: number | null;
  teacherRemark: string | null;
  nextTermBegins: string | null;
  principalSignature: string | null;
  promotion: { status: "PROMOTED" | "TRIAL" | "REPEAT"; text: string } | null;
  generatedAt: string;
}

export interface ReportIssue {
  level: "block" | "warn";
  code: string;
  message: string;
  details: string[];
}

export interface ClassBuild {
  classId: string;
  className: string;
  term: string;
  session: string;
  sessionId: string | null;
  milestone: Milestone;
  reports: StudentReport[];
  issues: ReportIssue[];
  /** results rows included in the reports (their milestone status is set on publish) */
  resultIds: string[];
  /** student id → enrollment id for the session (missing students have none yet) */
  enrollmentByStudent: Map<string, string>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function prFor(milestone: Milestone, raw: RawScores, isSenior: boolean, weeks: AssessmentWeeks): PRResult {
  if (milestone === "PR1") return calculatePR1(raw, isSenior, weeks);
  if (milestone === "PR2") return calculatePR2(raw, isSenior, weeks);
  return calculatePR3(raw, isSenior, weeks);
}

export function promotionFor(className: string, isSenior: boolean, pct: number): StudentReport["promotion"] {
  const digit = (className.match(/[123]/) || ["1"])[0];
  if (isSenior) {
    const next = digit === "1" ? "SSS 2" : digit === "2" ? "SSS 3" : "GRADUATION";
    if (pct >= 50) return { status: "PROMOTED", text: next === "GRADUATION" ? "GRADUATED" : `PROMOTED TO ${next}` };
    if (pct >= 45) return { status: "TRIAL", text: `PROMOTED TO ${next} ON TRIAL` };
    return { status: "REPEAT", text: `TO REPEAT SSS ${digit}` };
  }
  const next = digit === "1" ? "JSS 2" : digit === "2" ? "JSS 3" : "SSS 1";
  if (pct >= 50) return { status: "PROMOTED", text: `PROMOTED TO ${next}` };
  if (pct >= 40) return { status: "TRIAL", text: `PROMOTED TO ${next} ON TRIAL, BUT MUST ATTEND INTERVENTION CLASS` };
  return { status: "REPEAT", text: `TO REPEAT JSS ${digit}` };
}

/** Creates missing student_enrollments rows for the session (needed to store snapshots). */
export async function ensureEnrollments(service: any, classId: string, sessionId: string, studentIds: string[]) {
  if (!studentIds.length) return;
  const { data: existing, error } = await service
    .from("student_enrollments")
    .select("student_id")
    .eq("academic_session_id", sessionId)
    .in("student_id", studentIds);
  if (error) throw error;
  const have = new Set((existing || []).map((e: any) => e.student_id));
  const missing = studentIds.filter((id) => !have.has(id));
  // Keep the session's enrollment on the student's current class (e.g. after a track change)
  const present = studentIds.filter((id) => have.has(id));
  if (present.length) {
    await service
      .from("student_enrollments")
      .update({ class_id: classId })
      .eq("academic_session_id", sessionId)
      .in("student_id", present)
      .neq("class_id", classId);
  }
  if (missing.length) {
    const { error: insErr } = await service.from("student_enrollments").insert(
      missing.map((student_id) => ({ student_id, class_id: classId, academic_session_id: sessionId, status: "active" }))
    );
    if (insErr) throw insErr;
  }
}

export async function getLatestPrincipalSignature(service: any): Promise<string | null> {
  const { data } = await service
    .from("signatures")
    .select("signature_image_url")
    .eq("signer_role", "principal")
    .eq("is_active", true)
    .order("uploaded_at", { ascending: false })
    .limit(1);
  return data?.[0]?.signature_image_url || null;
}

export async function buildClassReports(
  service: any,
  opts: { classId: string; term: string; session: string; milestone: Milestone }
): Promise<ClassBuild> {
  const { classId, term, session, milestone } = opts;
  const issues: ReportIssue[] = [];
  const isTR = milestone === "TR";

  const { data: cls, error: clsErr } = await service
    .from("classes")
    .select("id, name, level")
    .eq("id", classId)
    .maybeSingle();
  if (clsErr) throw clsErr;
  if (!cls) throw new Error("Class not found.");
  const className: string = cls.name;
  const isSenior = cls.level === "senior" || isSeniorClass(className);

  const { data: sess } = await service.from("academic_sessions").select("id").eq("name", session).maybeSingle();
  const sessionId: string | null = sess?.id || null;

  const classSubjects = await getClassSubjects(service, classId);
  if (!classSubjects.length) {
    issues.push({
      level: "block",
      code: "no_subject_list",
      message: `${className} has no subject list. Set it up under Class Subject Lists.`,
      details: [],
    });
  }

  // Class list: the current session uses each student's current class; past
  // sessions use the class the student was enrolled in for that session.
  const { data: appSettings } = await service.from("app_settings").select("current_session").limit(1).maybeSingle();
  let studentQuery = service.from("students").select("id, name, admission_no").order("name");
  if (session && appSettings?.current_session && session !== appSettings.current_session) {
    const { data: enrolled } = sessionId
      ? await service.from("student_enrollments").select("student_id").eq("academic_session_id", sessionId).eq("class_id", classId)
      : { data: [] };
    // (the placeholder id keeps the filter valid when nobody was enrolled)
    const enrolledIds = (enrolled || []).map((e: any) => e.student_id);
    studentQuery = studentQuery.in("id", enrolledIds.length ? enrolledIds : ["00000000-0000-0000-0000-000000000000"]);
  } else {
    studentQuery = studentQuery.eq("class_id", classId);
  }
  const { data: studentRows, error: stErr } = await studentQuery;
  if (stErr) throw stErr;
  const students = (studentRows || []) as { id: string; name: string; admission_no: string }[];
  const studentIds = students.map((s) => s.id);
  if (!students.length) {
    issues.push({ level: "block", code: "no_students", message: `${className} has no students.`, details: [] });
  }

  const empty: ClassBuild = {
    classId,
    className,
    term,
    session,
    sessionId,
    milestone,
    reports: [],
    issues,
    resultIds: [],
    enrollmentByStudent: new Map(),
  };
  if (!classSubjects.length || !students.length) return empty;

  const [resultsRes, optOuts, enrollRes] = await Promise.all([
    service
      .from("results")
      .select("id, student_id, subject_id, status, total, score_breakdown")
      .eq("term", term)
      .eq("session", session)
      .in("student_id", studentIds),
    getOptOuts(service, session, studentIds),
    sessionId
      ? service.from("student_enrollments").select("id, student_id").eq("academic_session_id", sessionId).in("student_id", studentIds)
      : Promise.resolve({ data: [] }),
  ]);
  if (resultsRes.error) throw resultsRes.error;

  const resultByKey = new Map<string, any>();
  (resultsRes.data || []).forEach((r: any) => resultByKey.set(`${r.student_id}:${r.subject_id}`, r));
  const enrollmentByStudent = new Map<string, string>();
  (enrollRes.data || []).forEach((e: any) => enrollmentByStudent.set(e.student_id, e.id));

  // Earlier term totals for the third-term annual average: taken from the
  // published 1st/2nd term results (what students saw), else the saved total.
  const earlierTotals = new Map<string, number>();
  if (isTR && term === "term3") {
    const { data: earlier } = await service
      .from("results")
      .select("student_id, subject_id, term, total")
      .eq("session", session)
      .in("term", ["term1", "term2"])
      .in("student_id", studentIds);
    (earlier || []).forEach((r: any) => {
      if (r.total !== null && r.total !== undefined) earlierTotals.set(`${r.student_id}:${r.subject_id}:${r.term}`, Number(r.total));
    });

    const studentByEnrollment = new Map(Array.from(enrollmentByStudent.entries()).map(([sid, eid]) => [eid, sid]));
    if (studentByEnrollment.size) {
      const { data: snaps } = await service
        .from("result_snapshots")
        .select("enrollment_id, term, snapshot_data")
        .eq("report_type", "TR")
        .in("term", ["term1", "term2"])
        .in("enrollment_id", Array.from(studentByEnrollment.keys()));
      (snaps || []).forEach((snap: any) => {
        const sid = studentByEnrollment.get(snap.enrollment_id);
        (snap.snapshot_data?.subjects || []).forEach((line: SubjectLine) => {
          earlierTotals.set(`${sid}:${line.subjectId}:${snap.term}`, Number(line.total));
        });
      });
    }
  }

  const lines = new Map<string, SubjectLine[]>(); // student id → lines
  students.forEach((s) => lines.set(s.id, []));
  const resultIds: string[] = [];
  const notApproved: Record<string, string[]> = {};
  const returned: Record<string, string[]> = {};
  const missing: Record<string, string[]> = {};

  for (const subj of classSubjects) {
    const offering = students.filter((s) => !optOuts.has(`${s.id}:${subj.subject_id}`));
    const raws = new Map<string, RawScores>();
    offering.forEach((s) => {
      const row = resultByKey.get(`${s.id}:${subj.subject_id}`);
      if (row) raws.set(s.id, normalizeBreakdown(row));
    });
    const weeks = weeksForFrequency(subj.frequency);
    if (raws.size) {
      const lastWeek = milestone === "PR1" ? PR_WINDOWS.pr1 : milestone === "PR2" ? PR_WINDOWS.pr2 : PR_WINDOWS.pr3;
      const empty = emptyScheduledWeeks(Array.from(raws.values()), weeks, lastWeek);
      const parts = [
        empty.cw.length ? `classwork week ${empty.cw.join(", ")}` : "",
        empty.hw.length ? `homework week ${empty.hw.join(", ")}` : "",
      ].filter(Boolean);
      if (parts.length) {
        issues.push({
          level: "warn",
          code: "empty_weeks",
          message: `${subj.subject_name}: ${parts.join(" and ")} ${parts.length > 1 || empty.cw.length + empty.hw.length > 1 ? "are" : "is"} empty for the whole class and will count as 0.`,
          details: [],
        });
      }
    }

    const subjectLines: { studentId: string; line: SubjectLine; value: number }[] = [];
    for (const s of offering) {
      const row = resultByKey.get(`${s.id}:${subj.subject_id}`);
      const raw = raws.get(s.id);
      let line: SubjectLine | null = null;
      let value = 0;

      if (raw) {
        if (isTR) {
          const tr = calculateTR(raw, { isSenior, weeks });
          if (tr.hasData) {
            let grade = tr.grade;
            let remark = tr.remark;
            let term1: number | null = null;
            let term2: number | null = null;
            let annualAverage: number | null = null;
            value = tr.totalScore;
            if (term === "term3") {
              term1 = earlierTotals.get(`${s.id}:${subj.subject_id}:term1`) ?? null;
              term2 = earlierTotals.get(`${s.id}:${subj.subject_id}:term2`) ?? null;
              const parts = [term1, term2, tr.totalScore].filter((v): v is number => v !== null);
              annualAverage = round2(parts.reduce((a, b) => a + b, 0) / parts.length);
              ({ grade, remark } = getGradeAndRemark(annualAverage, isSenior));
              value = annualAverage;
            }
            line = {
              subjectId: subj.subject_id,
              name: subj.subject_name,
              creditUnit: subj.credit_unit,
              cw: tr.scaled.cw,
              hw: tr.scaled.hw,
              test: tr.scaled.tests,
              project: tr.scaled.project,
              exam: tr.scaled.exam,
              total: tr.totalScore,
              percentage: null,
              grade,
              remark,
              classAverage: null,
              lowest: null,
              highest: null,
              term1,
              term2,
              annualAverage,
            };
          }
        } else {
          const pr = prFor(milestone, raw, isSenior, weeks);
          if (pr.hasData) {
            value = pr.percentage;
            line = {
              subjectId: subj.subject_id,
              name: subj.subject_name,
              creditUnit: subj.credit_unit,
              cw: pr.cw,
              hw: pr.hw,
              test: pr.test,
              project: pr.project,
              exam: null,
              total: pr.totalCA,
              percentage: pr.percentage,
              grade: pr.grade,
              remark: pr.remark,
              classAverage: null,
              lowest: null,
              highest: null,
              term1: null,
              term2: null,
              annualAverage: null,
            };
          }
        }
      }

      if (!line) {
        (missing[subj.subject_name] ||= []).push(s.name);
        continue;
      }
      if (row.status === "returned") (returned[subj.subject_name] ||= []).push(s.name);
      else if (row.status !== "approved") (notApproved[subj.subject_name] ||= []).push(`${s.name} (${row.status})`);
      resultIds.push(row.id);
      subjectLines.push({ studentId: s.id, line, value });
    }

    // Class average, lowest and highest over students who take the subject
    if (subjectLines.length) {
      const values = subjectLines.map((l) => l.value);
      const avg = round1(values.reduce((a, b) => a + b, 0) / values.length);
      const lo = round1(Math.min(...values));
      const hi = round1(Math.max(...values));
      subjectLines.forEach(({ studentId, line }) => {
        line.classAverage = avg;
        line.lowest = lo;
        line.highest = hi;
        lines.get(studentId)!.push(line);
      });
    }
  }

  for (const [subject, names] of Object.entries(returned)) {
    issues.push({
      level: "block",
      code: "returned",
      message: `${subject}: returned to the teacher for correction and not resubmitted (${names.length} student${names.length === 1 ? "" : "s"}).`,
      details: names,
    });
  }
  for (const [subject, names] of Object.entries(notApproved)) {
    issues.push({
      level: "block",
      code: "not_approved",
      message: `${subject}: ${names.length} score${names.length === 1 ? "" : "s"} not approved yet.`,
      details: names,
    });
  }
  for (const [subject, names] of Object.entries(missing)) {
    issues.push({
      level: "warn",
      code: "missing_scores",
      message: `${subject}: ${names.length} student${names.length === 1 ? " has" : "s have"} no ${milestone} scores and ${names.length === 1 ? "is" : "are"} not marked "Not offering".`,
      details: names,
    });
  }

  // Attendance, evaluations and report settings (terminal result only)
  const attendanceByStudent = new Map<string, StudentReport["attendance"]>();
  const evalByStudent = new Map<string, any>();
  let nextTermBegins: string | null = null;
  let signature: string | null = null;

  if (isTR) {
    const enrollIds = Array.from(enrollmentByStudent.values());
    const [summRes, evalRes, termRes, recRes, sig] = await Promise.all([
      enrollIds.length
        ? service.from("attendance_summaries").select("enrollment_id, times_opened, times_present, times_absent").eq("term", term).in("enrollment_id", enrollIds)
        : Promise.resolve({ data: [] }),
      enrollIds.length
        ? service.from("student_evaluations").select("*").eq("term", term).in("enrollment_id", enrollIds)
        : Promise.resolve({ data: [] }),
      sessionId
        ? service.from("academic_terms").select("school_days, next_term_begins").eq("academic_session_id", sessionId).eq("term_code", term).maybeSingle()
        : Promise.resolve({ data: null }),
      enrollIds.length
        ? service.from("attendance_records").select("enrollment_id, am_present, pm_present").eq("term", term).in("enrollment_id", enrollIds)
        : Promise.resolve({ data: [] }),
      getLatestPrincipalSignature(service),
    ]);

    const studentByEnrollment = new Map(Array.from(enrollmentByStudent.entries()).map(([sid, eid]) => [eid, sid]));
    const schoolTimesOpened = Number(termRes.data?.school_days) || null;

    (summRes.data || []).forEach((a: any) => {
      const sid = studentByEnrollment.get(a.enrollment_id);
      if (!sid) return;
      const opened = Number(a.times_opened) || 0;
      const present = Number(a.times_present) || 0;
      attendanceByStudent.set(sid, { opened, present, absent: Math.max(0, opened - present) });
    });
    const presentCounts = new Map<string, number>();
    (recRes.data || []).forEach((r: any) => {
      const sid = studentByEnrollment.get(r.enrollment_id);
      if (!sid) return;
      presentCounts.set(sid, (presentCounts.get(sid) || 0) + (r.am_present ? 1 : 0) + (r.pm_present ? 1 : 0));
    });
    presentCounts.forEach((present, sid) => {
      if (!attendanceByStudent.has(sid) && schoolTimesOpened) {
        attendanceByStudent.set(sid, { opened: schoolTimesOpened, present, absent: Math.max(0, schoolTimesOpened - present) });
      }
    });

    (evalRes.data || []).forEach((e: any) => {
      const sid = studentByEnrollment.get(e.enrollment_id);
      if (sid) evalByStudent.set(sid, e);
    });

    nextTermBegins = termRes.data?.next_term_begins || null;
    signature = sig;

    const noAttendance = students.filter((s) => !attendanceByStudent.has(s.id)).map((s) => s.name);
    if (noAttendance.length) {
      issues.push({
        level: "warn",
        code: "no_attendance",
        message: `${noAttendance.length} student${noAttendance.length === 1 ? " has" : "s have"} no attendance recorded.`,
        details: noAttendance,
      });
    }
    const noEval = students
      .filter((s) => {
        const e = evalByStudent.get(s.id);
        return !e || !e.teacher_remark || !e.skills || !Object.keys(e.skills).length;
      })
      .map((s) => s.name);
    if (noEval.length) {
      issues.push({
        level: "warn",
        code: "no_evaluation",
        message: `Personal skills or class teacher's remark missing for ${noEval.length} student${noEval.length === 1 ? "" : "s"}.`,
        details: noEval,
      });
    }
    if (!signature) {
      issues.push({ level: "warn", code: "no_signature", message: "Principal's signature has not been uploaded.", details: [] });
    }
    if (!nextTermBegins && term !== "term3") {
      issues.push({ level: "warn", code: "no_next_term", message: "Next term resumption date is not set.", details: [] });
    }
  }

  // Overall results per student
  const overall = new Map<string, { total: number; percentage: number; gpa: number | null }>();
  students.forEach((s) => {
    const ls = lines.get(s.id)!;
    if (!ls.length) return;
    if (isTR) {
      const vals = ls.map((l) => (l.annualAverage ?? l.total));
      const total = round2(vals.reduce((a, b) => a + b, 0));
      const percentage = round2(total / ls.length);
      const gpa = calculateGPA(ls.map((l) => ({ total: l.annualAverage ?? l.total, creditUnit: l.creditUnit })));
      overall.set(s.id, { total, percentage, gpa });
    } else {
      const total = round2(ls.reduce((a, l) => a + l.total, 0));
      const percentage = round2(ls.reduce((a, l) => a + (l.percentage || 0), 0) / ls.length);
      overall.set(s.id, { total, percentage, gpa: null });
    }
  });

  const positions = isTR
    ? rankPositions(
        students
          .filter((s) => overall.has(s.id))
          .map((s) => ({ id: s.id, value: isSenior ? overall.get(s.id)!.gpa : overall.get(s.id)!.percentage }))
      )
    : new Map<string, number>();
  const rankedCount = isTR ? positions.size : null;

  const now = new Date().toISOString();
  const reports: StudentReport[] = students
    .filter((s) => overall.has(s.id))
    .map((s) => {
      const o = overall.get(s.id)!;
      const { grade, remark } = getGradeAndRemark(o.percentage, isSenior);
      const ev = evalByStudent.get(s.id);
      const skillScores = ev?.skills && typeof ev.skills === "object" ? ev.skills : null;
      const skills = isTR
        ? PERSONAL_SKILLS.map((k) => ({
            key: k.key,
            label: k.label,
            score: skillScores && Number.isFinite(Number(skillScores[k.key])) ? Number(skillScores[k.key]) : null,
          }))
        : null;
      const skillsTotal = skills && skills.some((k) => k.score !== null) ? skills.reduce((a, k) => a + (k.score || 0), 0) : null;

      return {
        version: 1 as const,
        milestone,
        milestoneLabel: MILESTONE_LABELS[milestone],
        term,
        termLabel: TERM_LABELS[term] || term,
        session,
        classId,
        className,
        isSenior,
        classSize: students.length,
        student: { id: s.id, name: s.name, admissionNo: s.admission_no },
        subjects: lines.get(s.id)!,
        summary: {
          total: o.total,
          percentage: o.percentage,
          grade,
          remark,
          gpa: o.gpa,
          position: isTR ? positions.get(s.id) ?? null : null,
          rankedCount,
          principalRemark: isTR ? ev?.principal_remark || principalRemark(isSenior, o.percentage, o.gpa) : null,
        },
        attendance: isTR ? attendanceByStudent.get(s.id) || null : null,
        skills: skills && skills.some((k) => k.score !== null) ? skills : null,
        skillsTotal,
        teacherRemark: isTR ? ev?.teacher_remark || null : null,
        nextTermBegins: isTR ? nextTermBegins : null,
        principalSignature: isTR ? signature : null,
        promotion: isTR && term === "term3" ? promotionFor(className, isSenior, o.percentage) : null,
        generatedAt: now,
      };
    });

  return { ...empty, reports, issues, resultIds, enrollmentByStudent };
}
