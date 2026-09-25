import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { calculateStudentResult, emptyRawScores, normalizeBreakdown, toStoredScores } from "@/lib/gradingEngine";

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const body = await req.json();
    const { examId, component = "exam" } = body; // 'exam' (max 70) or 'test' (max 30)

    if (!examId) {
      return NextResponse.json({ ok: false, error: "examId is required" }, { status: 400 });
    }

    // 1. Fetch CBT Exam Details
    const { data: exam, error: examErr } = await service
      .from("cbt_exams")
      .select("id, title, class_id, subject_id, term, session, academic_session_id")
      .eq("id", examId)
      .single();

    if (examErr || !exam) {
      return NextResponse.json({ ok: false, error: "Exam not found" }, { status: 404 });
    }

    if (!exam.subject_id) {
      return NextResponse.json(
        { ok: false, error: "This CBT exam does not have a linked subject_id. Assign a subject first." },
        { status: 400 }
      );
    }

    // 2. Fetch all submissions for this exam
    const { data: submissions, error: subErr } = await service
      .from("cbt_submissions")
      .select("id, student_id, score, total_questions, students(id, name, admission_no)")
      .eq("exam_id", examId);

    if (subErr) throw subErr;

    if (!submissions || submissions.length === 0) {
      return NextResponse.json({ ok: true, message: "No student submissions found to sync.", syncedCount: 0 });
    }

    // Resolve academic session name if missing
    let sessionName = exam.session;
    let academicSessionId = exam.academic_session_id;
    if (!sessionName) {
      const { data: activeSess } = await service
        .from("academic_sessions")
        .select("id, name")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      sessionName = activeSess?.name || "2026/2027";
      academicSessionId = activeSess?.id || null;
    }

    const term = exam.term || "term1";
    const maxScore = component === "exam" ? 70 : 30;

    let syncedCount = 0;
    const errors: string[] = [];

    for (const sub of submissions) {
      try {
        const totalQ = sub.total_questions || 1;
        const rawScore = Number(sub.score || 0);
        const scaledScore = Math.min(maxScore, Math.round((rawScore / totalQ) * maxScore));

        // Fetch existing result row
        const { data: existingResult } = await service
          .from("results")
          .select("*")
          .eq("student_id", sub.student_id)
          .eq("subject_id", exam.subject_id)
          .eq("term", term)
          .eq("session", sessionName)
          .maybeSingle();

        const rawBreakdown = existingResult ? normalizeBreakdown(existingResult) : emptyRawScores();

        if (component === "exam") {
          rawBreakdown.exam = String(scaledScore);
        } else {
          // Put into test 3 or highest weighted test slot
          rawBreakdown.tests[2] = String(scaledScore);
        }

        const calculated = calculateStudentResult(rawBreakdown);
        const stored = toStoredScores(calculated);

        const payload: any = {
          student_id: sub.student_id,
          subject_id: exam.subject_id,
          class_id: exam.class_id,
          term,
          session: sessionName,
          academic_session_id: academicSessionId,
          score_breakdown: rawBreakdown,
          cw: stored.cw,
          hw: stored.hw,
          test: stored.test,
          project: stored.project,
          exam: stored.exam,
          total: stored.total,
          grade: stored.grade,
          status: existingResult?.status || "draft",
          updated_at: new Date().toISOString(),
        };

        if (existingResult?.id) {
          payload.id = existingResult.id;
        }

        const { error: upsertErr } = await service
          .from("results")
          .upsert(payload, { onConflict: "student_id,subject_id,term,session" });

        if (upsertErr) {
          // Fallback to student_id,subject_id,term if session not in unique constraint
          const { error: fbErr } = await service
            .from("results")
            .upsert(payload, { onConflict: "student_id,subject_id,term" });
          if (fbErr) throw fbErr;
        }

        // Mark submission as synced
        await service.from("cbt_submissions").update({ synced_to_results: true }).eq("id", sub.id);
        syncedCount++;
      } catch (err: any) {
        errors.push(`Failed for student ${sub.student_id}: ${err.message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Successfully synced ${syncedCount} CBT scores to the gradebook!`,
      syncedCount,
      totalSubmissions: submissions.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error("import-to-gradebook error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Failed to sync scores" }, { status: 500 });
  }
}
