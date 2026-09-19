"use client";

import React, { useState, useEffect } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { supabase } from "@/lib/supabase/client";
import { getAppSettings } from "@/lib/appSettings";
import {
  calculateStudentResult,
  emptyRawScores,
  normalizeBreakdown,
  toStoredScores,
} from "@/lib/gradingEngine";
import * as XLSX from "xlsx";

interface AssessmentItem {
  id: string;
  title: string;
  description?: string | null;
  class_id: string;
  subject_id: string;
  session: string;
  term: string;
  assessment_type: string;
  duration: number;
  pass_mark: number;
  total_marks: number;
  instructions?: string | null;
  allow_result_view: boolean;
  start_date?: string | null;
  end_date?: string | null;
  status: "draft" | "published" | "archived";
  classes?: { name: string } | null;
  subjects?: { name: string } | null;
  submissions_count?: number;
}

interface QuestionItem {
  id?: string;
  question: string;
  question_type: string;
  options: string[] | null;
  correct_answer: string;
  explanation?: string | null;
  marks: number;
  position: number;
}

interface SubmissionItem {
  id: string;
  assessment_id: string;
  student_id: string;
  started_at?: string | null;
  submitted_at?: string | null;
  time_taken?: number | null;
  total_score?: number | null;
  percentage?: number | null;
  status: string;
  students?: { name: string; admission_no: string } | null;
}

interface AnswerItem {
  id: string;
  submission_id: string;
  question_id: string;
  student_answer?: string | null;
  awarded_marks?: number | null;
  is_correct?: boolean | null;
  teacher_feedback?: string | null;
}

export default function TeacherAssessmentsPage() {
  const [view, setView] = useState<"dashboard" | "editor" | "submissions" | "uploader">("dashboard");
  const [loading, setLoading] = useState(true);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published" | "archived">("all");
  const [classFilter, setClassFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");

  // Teacher metadata & assignments
  const [teacherId, setTeacherId] = useState<string>("");
  const [teacherClasses, setTeacherClasses] = useState<{ id: string; name: string }[]>([]);
  const [teacherSubjects, setTeacherSubjects] = useState<{ id: string; name: string }[]>([]);
  const [assessments, setAssessments] = useState<AssessmentItem[]>([]);
  const [currentSession, setCurrentSession] = useState("");
  const [currentTerm, setCurrentTerm] = useState("term1");

  // Stats
  const [totalAssessments, setTotalAssessments] = useState(0);
  const [pendingGrading, setPendingGrading] = useState(0);
  const [avgScore, setAvgScore] = useState("—");

  // Editor State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formClassId, setFormClassId] = useState("");
  const [formSubjectId, setFormSubjectId] = useState("");
  const [formType, setFormType] = useState("Test 1 (Week 3)");
  const [formDurationSelect, setFormDurationSelect] = useState("30");
  const [formDuration, setFormDuration] = useState(30);
  const [formPassMark, setFormPassMark] = useState(10);
  const [formTotalMarks, setFormTotalMarks] = useState(0);
  const [formInstructions, setFormInstructions] = useState("");
  const [formAllowResult, setFormAllowResult] = useState(true);
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [savingAssessment, setSavingAssessment] = useState(false);

  // Submissions State
  const [activeAssessmentTitle, setActiveAssessmentTitle] = useState("");
  const [activeAssessmentId, setActiveAssessmentId] = useState("");
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  // Grading Modal State
  const [isGradingOpen, setIsGradingOpen] = useState(false);
  const [activeSubmission, setActiveSubmission] = useState<SubmissionItem | null>(null);
  const [activeQuestions, setActiveQuestions] = useState<QuestionItem[]>([]);
  const [activeAnswers, setActiveAnswers] = useState<AnswerItem[]>([]);
  const [gradingMaxScore, setGradingMaxScore] = useState(0);
  const [savingGrades, setSavingGrades] = useState(false);

  // Uploader State
  const [uploadClassId, setUploadClassId] = useState("");
  const [uploadSubjectId, setUploadSubjectId] = useState("");
  const [uploadAssessmentId, setUploadAssessmentId] = useState("");
  const [uploadAssessmentOptions, setUploadAssessmentOptions] = useState<{ id: string; title: string }[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadedFileSize, setUploadedFileSize] = useState("");
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [invalidRowsCount, setInvalidRowsCount] = useState(0);
  const [importingScores, setImportingScores] = useState(false);

  const initTeacherData = async () => {
    setLoading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) return;
      setTeacherId(user.id);

      const settings = await getAppSettings();
      setCurrentSession(settings?.current_session || "");
      setCurrentTerm(settings?.current_term || "term1");

      // Fetch teacher assignments
      const { data: assignments } = await supabase
        .from("teacher_assignments")
        .select("class_id, subject_id, classes(name), subjects(name)")
        .eq("teacher_user_id", user.id);

      const classesMap = new Map<string, string>();
      const subjectsMap = new Map<string, string>();

      (assignments || []).forEach((ta: any) => {
        if (ta.classes && !classesMap.has(ta.class_id)) {
          classesMap.set(ta.class_id, ta.classes.name);
        }
        if (ta.subjects && !subjectsMap.has(ta.subject_id)) {
          subjectsMap.set(ta.subject_id, ta.subjects.name);
        }
      });

      const cList = Array.from(classesMap.entries()).map(([id, name]) => ({ id, name }));
      const sList = Array.from(subjectsMap.entries()).map(([id, name]) => ({ id, name }));
      cList.sort((a, b) => a.name.localeCompare(b.name));
      sList.sort((a, b) => a.name.localeCompare(b.name));

      setTeacherClasses(cList);
      setTeacherSubjects(sList);

      if (cList.length > 0) {
        setFormClassId(cList[0].id);
        setUploadClassId(cList[0].id);
      }
      if (sList.length > 0) {
        setFormSubjectId(sList[0].id);
        setUploadSubjectId(sList[0].id);
      }

      await loadAssessments(user.id);
    } catch (err: any) {
      console.error("Init Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadAssessments = async (tId: string) => {
    try {
      const { data, error } = await supabase
        .from("assessments")
        .select("*, classes(name), subjects(name)")
        .eq("teacher_id", tId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      const list: AssessmentItem[] = data || [];

      // Fetch submission counts
      for (const a of list) {
        const { count } = await supabase
          .from("assessment_submissions")
          .select("*", { count: "exact", head: true })
          .eq("assessment_id", a.id);
        a.submissions_count = count || 0;
      }

      setAssessments(list);
      setTotalAssessments(list.length);

      // Compute stats
      const aIds = list.map((a) => a.id);
      if (aIds.length > 0) {
        const { count: pending } = await supabase
          .from("assessment_submissions")
          .select("id", { count: "exact", head: true })
          .in("assessment_id", aIds)
          .eq("status", "submitted");
        setPendingGrading(pending || 0);

        const { data: gradedData } = await supabase
          .from("assessment_submissions")
          .select("percentage")
          .in("assessment_id", aIds)
          .eq("status", "graded");

        if (gradedData && gradedData.length > 0) {
          const sum = gradedData.reduce((s, d) => s + (Number(d.percentage) || 0), 0);
          setAvgScore(Math.round(sum / gradedData.length) + "%");
        } else {
          setAvgScore("—");
        }
      } else {
        setPendingGrading(0);
        setAvgScore("—");
      }
    } catch (err) {
      console.error("Load assessments error:", err);
    }
  };

  useEffect(() => {
    initTeacherData();
  }, []);

  // Filter assessments
  const filteredAssessments = assessments.filter((a) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (classFilter && a.class_id !== classFilter) return false;
    if (subjectFilter && a.subject_id !== subjectFilter) return false;
    return true;
  });

  // Recompute total marks whenever questions change
  useEffect(() => {
    const sum = questions.reduce((acc, q) => acc + (Number(q.marks) || 0), 0);
    setFormTotalMarks(sum);
  }, [questions]);

  // Open Editor for new or existing
  const openEditor = async (assessment?: AssessmentItem) => {
    if (assessment) {
      setEditingId(assessment.id);
      setFormTitle(assessment.title || "");
      setFormDesc(assessment.description || "");
      setFormClassId(assessment.class_id || "");
      setFormSubjectId(assessment.subject_id || "");
      setFormType(assessment.assessment_type || "Test 1 (Week 3)");

      const standardIntervals = ["10", "15", "20", "30", "40", "45", "60", "90", "120", "180"];
      if (standardIntervals.includes(String(assessment.duration))) {
        setFormDurationSelect(String(assessment.duration));
        setFormDuration(assessment.duration);
      } else {
        setFormDurationSelect("custom");
        setFormDuration(assessment.duration || 30);
      }

      setFormPassMark(assessment.pass_mark || 10);
      setFormInstructions(assessment.instructions || "");
      setFormAllowResult(assessment.allow_result_view ?? true);
      setFormStartDate(assessment.start_date ? new Date(assessment.start_date).toISOString().substring(0, 16) : "");
      setFormEndDate(assessment.end_date ? new Date(assessment.end_date).toISOString().substring(0, 16) : "");

      // Load questions
      const { data: qData } = await supabase
        .from("assessment_questions")
        .select("*")
        .eq("assessment_id", assessment.id)
        .order("position", { ascending: true });
      setQuestions(qData || []);
    } else {
      setEditingId(null);
      setFormTitle("");
      setFormDesc("");
      setFormType("Test 1 (Week 3)");
      setFormDurationSelect("30");
      setFormDuration(30);
      setFormPassMark(10);
      setFormInstructions("");
      setFormAllowResult(true);
      setFormStartDate("");
      setFormEndDate("");
      setQuestions([
        {
          question: "",
          question_type: "Multiple Choice",
          options: ["", "", "", ""],
          correct_answer: "0",
          explanation: "",
          marks: 5,
          position: 0,
        },
      ]);
    }
    setView("editor");
  };

  const handleAddQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      {
        question: "",
        question_type: "Multiple Choice",
        options: ["", "", "", ""],
        correct_answer: "0",
        explanation: "",
        marks: 5,
        position: prev.length,
      },
    ]);
  };

  const handleUpdateQuestion = (index: number, field: keyof QuestionItem, value: any) => {
    setQuestions((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRemoveQuestion = (index: number) => {
    setQuestions((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.map((q, i) => ({ ...q, position: i }));
    });
  };

  const handleSaveAssessment = async (status: "draft" | "published") => {
    if (!formTitle.trim() || !formClassId || !formSubjectId || !formDuration) {
      alert("Please fill in all required fields.");
      return;
    }
    if (questions.length === 0) {
      alert("Please add at least one question.");
      return;
    }

    setSavingAssessment(true);
    try {
      const payload = {
        teacher_id: teacherId,
        class_id: formClassId,
        subject_id: formSubjectId,
        session: currentSession,
        term: currentTerm,
        title: formTitle.trim(),
        description: formDesc.trim() || null,
        assessment_type: formType,
        duration: Number(formDuration),
        pass_mark: Number(formPassMark),
        total_marks: Number(formTotalMarks),
        instructions: formInstructions.trim() || null,
        allow_result_view: formAllowResult,
        start_date: formStartDate ? new Date(formStartDate).toISOString() : null,
        end_date: formEndDate ? new Date(formEndDate).toISOString() : null,
        status,
      };

      let assessmentId = editingId;
      if (editingId) {
        const { error } = await supabase.from("assessments").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("assessments").insert([payload]).select().single();
        if (error) throw error;
        assessmentId = data.id;
      }

      // Delete old questions & re-insert
      await supabase.from("assessment_questions").delete().eq("assessment_id", assessmentId);

      const qPayload = questions.map((q, i) => ({
        assessment_id: assessmentId,
        question: q.question,
        question_type: q.question_type,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation || null,
        marks: Number(q.marks) || 1,
        position: i,
      }));

      const { error: qErr } = await supabase.from("assessment_questions").insert(qPayload);
      if (qErr) throw qErr;

      alert(`Assessment saved as ${status.toUpperCase()}!`);
      await loadAssessments(teacherId);
      setView("dashboard");
    } catch (err: any) {
      alert("Failed to save assessment: " + err.message);
    } finally {
      setSavingAssessment(false);
    }
  };

  const handleToggleStatus = async (a: AssessmentItem, newStatus: "draft" | "published" | "archived") => {
    try {
      const { error } = await supabase.from("assessments").update({ status: newStatus }).eq("id", a.id);
      if (error) throw error;
      await loadAssessments(teacherId);
    } catch (err: any) {
      alert("Failed to update status: " + err.message);
    }
  };

  const handleDeleteAssessment = async (id: string) => {
    if (!confirm("Are you sure you want to delete this assessment? All student attempts will be removed.")) return;
    try {
      const { error } = await supabase.from("assessments").delete().eq("id", id);
      if (error) throw error;
      await loadAssessments(teacherId);
    } catch (err: any) {
      alert("Failed to delete assessment: " + err.message);
    }
  };

  const handleDuplicateAssessment = async (a: AssessmentItem) => {
    try {
      const { data: origQuestions } = await supabase
        .from("assessment_questions")
        .select("*")
        .eq("assessment_id", a.id)
        .order("position", { ascending: true });

      const duplicatePayload = {
        teacher_id: teacherId,
        class_id: a.class_id,
        subject_id: a.subject_id,
        session: a.session,
        term: a.term,
        title: "Copy of " + a.title,
        description: a.description,
        assessment_type: a.assessment_type,
        duration: a.duration,
        pass_mark: a.pass_mark,
        total_marks: a.total_marks,
        instructions: a.instructions,
        allow_result_view: a.allow_result_view,
        start_date: a.start_date,
        end_date: a.end_date,
        status: "draft",
      };

      const { data: newA, error } = await supabase.from("assessments").insert([duplicatePayload]).select().single();
      if (error) throw error;

      if (origQuestions && origQuestions.length > 0) {
        const newQs = origQuestions.map((q) => ({
          assessment_id: newA.id,
          question: q.question,
          question_type: q.question_type,
          options: q.options,
          correct_answer: q.correct_answer,
          explanation: q.explanation,
          marks: q.marks,
          position: q.position,
        }));
        await supabase.from("assessment_questions").insert(newQs);
      }

      alert("Assessment duplicated as draft!");
      await loadAssessments(teacherId);
    } catch (err: any) {
      alert("Failed to duplicate: " + err.message);
    }
  };

  // Submissions Flow
  const openSubmissions = async (assessmentId: string, title: string) => {
    setActiveAssessmentId(assessmentId);
    setActiveAssessmentTitle(title);
    setView("submissions");
    setLoadingSubmissions(true);

    try {
      const { data, error } = await supabase
        .from("assessment_submissions")
        .select("*, students(name, admission_no)")
        .eq("assessment_id", assessmentId)
        .order("submitted_at", { ascending: false });

      if (error) throw error;
      setSubmissions(data || []);
    } catch (err: any) {
      alert("Error loading submissions: " + err.message);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const openGradingModal = async (sub: SubmissionItem) => {
    setActiveSubmission(sub);
    setIsGradingOpen(true);

    try {
      const [aRes, qRes, ansRes] = await Promise.all([
        supabase.from("assessments").select("total_marks").eq("id", sub.assessment_id).single(),
        supabase.from("assessment_questions").select("*").eq("assessment_id", sub.assessment_id).order("position", { ascending: true }),
        supabase.from("assessment_answers").select("*").eq("submission_id", sub.id),
      ]);

      setGradingMaxScore(aRes.data?.total_marks || 0);
      setActiveQuestions(qRes.data || []);
      setActiveAnswers(ansRes.data || []);
    } catch (err: any) {
      console.error("Grading load error:", err);
    }
  };

  const handleUpdateAnswerScore = (qId: string, maxMarks: number, score: number) => {
    const clamped = Math.max(0, Math.min(maxMarks, score));
    setActiveAnswers((prev) => {
      const idx = prev.findIndex((a) => a.question_id === qId);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        awarded_marks: clamped,
        is_correct: clamped >= maxMarks / 2,
      };
      return updated;
    });
  };

  const handleUpdateAnswerFeedback = (qId: string, feedback: string) => {
    setActiveAnswers((prev) => {
      const idx = prev.findIndex((a) => a.question_id === qId);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], teacher_feedback: feedback };
      return updated;
    });
  };

  const currentGradingTotal = activeAnswers.reduce((acc, a) => acc + (Number(a.awarded_marks) || 0), 0);

  const handleSaveGrades = async () => {
    if (!activeSubmission) return;
    setSavingGrades(true);
    try {
      for (const ans of activeAnswers) {
        await supabase
          .from("assessment_answers")
          .update({
            awarded_marks: ans.awarded_marks,
            is_correct: ans.is_correct,
            teacher_feedback: ans.teacher_feedback,
          })
          .eq("id", ans.id);
      }

      const finalPct = gradingMaxScore > 0 ? (currentGradingTotal / gradingMaxScore) * 100 : 0;
      await supabase
        .from("assessment_submissions")
        .update({
          total_score: currentGradingTotal,
          percentage: finalPct,
          status: "graded",
        })
        .eq("id", activeSubmission.id);

      alert("Grades saved successfully!");
      setIsGradingOpen(false);
      await openSubmissions(activeSubmission.assessment_id, activeAssessmentTitle);
    } catch (err: any) {
      alert("Failed to save grades: " + err.message);
    } finally {
      setSavingGrades(false);
    }
  };

  const exportSubmissionToGradebook = async (submissionId: string) => {
    try {
      const { data: sub, error } = await supabase
        .from("assessment_submissions")
        .select("*, assessments(*)")
        .eq("id", submissionId)
        .single();
      if (error) throw error;
      if (sub.status !== "graded") {
        alert("This attempt is not fully graded yet.");
        return;
      }

      const a = sub.assessments;
      const targetType = a.assessment_type;
      let maxScore = 0;
      if (targetType === "Test 1 (Week 3)") maxScore = 15;
      else if (targetType === "Test 2 (Week 6)") maxScore = 15;
      else if (targetType === "Test 3 (Week 9)") maxScore = 30;
      else if (targetType === "Term Exam") maxScore = 70;
      else {
        alert(`Assessment of type "${targetType}" cannot be exported to the academic gradebook.`);
        return;
      }

      const totalMarks = Number(a.total_marks || 0);
      if (totalMarks <= 0) {
        alert("Total marks must be greater than zero.");
        return;
      }

      const rawScore = Number(sub.total_score || 0);
      const scaledScore = Math.round((rawScore / totalMarks) * maxScore);

      const { data: existingResult } = await supabase
        .from("results")
        .select("*")
        .eq("student_id", sub.student_id)
        .eq("subject_id", a.subject_id)
        .eq("term", a.term)
        .maybeSingle();

      let rawBreakdown = existingResult ? normalizeBreakdown(existingResult) : emptyRawScores();

      if (targetType === "Test 1 (Week 3)") rawBreakdown.tests[0] = String(scaledScore);
      else if (targetType === "Test 2 (Week 6)") rawBreakdown.tests[1] = String(scaledScore);
      else if (targetType === "Test 3 (Week 9)") rawBreakdown.tests[2] = String(scaledScore);
      else if (targetType === "Term Exam") rawBreakdown.exam = String(scaledScore);

      const finalResult = calculateStudentResult(rawBreakdown);
      const storedMetrics = toStoredScores(finalResult);

      const payload: any = {
        student_id: sub.student_id,
        subject_id: a.subject_id,
        term: a.term,
        submitted_by: teacherId,
        status: existingResult?.status || "draft",
        score_breakdown: rawBreakdown,
        cw: storedMetrics.cw,
        hw: storedMetrics.hw,
        test: storedMetrics.test,
        project: storedMetrics.project,
        exam: storedMetrics.exam,
        total: storedMetrics.total,
        grade: storedMetrics.grade,
      };
      if (existingResult?.id) payload.id = existingResult.id;

      const { error: upsertErr } = await supabase
        .from("results")
        .upsert(payload, { onConflict: "student_id,subject_id,term" });
      if (upsertErr) throw upsertErr;

      alert(`Successfully exported to gradebook! Scaled score: ${scaledScore} / ${maxScore}.`);
    } catch (err: any) {
      alert("Export failed: " + err.message);
    }
  };

  // Uploader Flow
  const handleFileSelected = (file: File) => {
    setUploadedFileName(file.name);
    setUploadedFileSize(Math.round(file.size / 1024) + " KB");

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

        if (!json || json.length < 2) {
          alert("Empty sheet. Row 1 must have headers.");
          return;
        }

        const headers = json[0].map((h) => String(h || "").trim().toLowerCase());
        const admIdx = headers.findIndex((h) => h.includes("admission") || h.includes("adm"));
        const scoreIdx = headers.findIndex((h) => h.includes("score") || h.includes("mark"));
        const remarkIdx = headers.findIndex((h) => h.includes("remark") || h.includes("note"));

        if (admIdx === -1 || scoreIdx === -1) {
          alert("Could not map headers. Must contain 'Admission Number' and 'Score' columns.");
          return;
        }

        const { data: students } = await supabase
          .from("students")
          .select("id, admission_no, name")
          .eq("class_id", uploadClassId);

        const studentsMap = new Map((students || []).map((s) => [String(s.admission_no || "").trim().toLowerCase(), s]));

        const rows: any[] = [];
        let invalid = 0;

        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row || !row.length) continue;

          const admVal = String(row[admIdx] || "").trim();
          const scoreVal = row[scoreIdx];
          const remarkVal = remarkIdx !== -1 ? String(row[remarkIdx] || "").trim() : "";

          const matched = studentsMap.get(admVal.toLowerCase());
          let isValid = true;
          let statusText = "Validated";

          if (!matched) {
            statusText = "Student not in class";
            isValid = false;
          } else if (scoreVal === undefined || scoreVal === null || isNaN(Number(scoreVal)) || Number(scoreVal) < 0) {
            statusText = "Invalid score";
            isValid = false;
          }

          if (!isValid) invalid++;

          rows.push({
            student_id: matched?.id || null,
            admission_no: admVal,
            student_name: matched?.name || "—",
            score: scoreVal !== undefined && !isNaN(Number(scoreVal)) ? Number(scoreVal) : 0,
            remarks: remarkVal,
            isValid,
            statusText,
          });
        }

        setParsedRows(rows);
        setInvalidRowsCount(invalid);
      } catch (err: any) {
        alert("Failed to parse file: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSaveUploadedScores = async () => {
    if (!uploadClassId || !uploadSubjectId) {
      alert("Please select Class and Subject.");
      return;
    }
    setImportingScores(true);
    try {
      const payload = parsedRows.map((row) => ({
        teacher_id: teacherId,
        subject_id: uploadSubjectId,
        class_id: uploadClassId,
        assessment_id: uploadAssessmentId || null,
        student_id: row.student_id,
        score: row.score,
        remarks: row.remarks,
      }));

      const { error } = await supabase.from("uploaded_scores").insert(payload);
      if (error) throw error;

      alert("Scores imported successfully!");
      setParsedRows([]);
      setUploadedFileName("");
      setView("dashboard");
    } catch (err: any) {
      alert("Import failed: " + err.message);
    } finally {
      setImportingScores(false);
    }
  };

  return (
    <AuthGuard allowedRoles={["teacher"]}>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="portal-header bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 shrink-0">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Manage Assessments</h1>
            <p className="text-sm text-slate-500 mt-1">Create, grade, and organize assessments for your students.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openEditor()}
              className="px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition-colors shadow-sm text-sm"
            >
              Create Assessment
            </button>
            <button
              onClick={() => {
                setParsedRows([]);
                setUploadedFileName("");
                setView("uploader");
              }}
              className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm text-sm"
            >
              Manual Score Upload
            </button>
          </div>
        </header>

        <div className="portal-content p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full flex-1 overflow-y-auto">
          {/* 1. DASHBOARD VIEW */}
          {view === "dashboard" && (
            <div className="space-y-6">
              {/* Stats Bar */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Assessments</div>
                    <div className="text-2xl font-bold text-slate-900">{totalAssessments}</div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pending Grading</div>
                    <div className="text-2xl font-bold text-amber-600">{pendingGrading}</div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Average Class Score</div>
                    <div className="text-2xl font-bold text-emerald-600">{avgScore}</div>
                  </div>
                </div>
              </div>

              {/* Filters Panel */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Status:</span>
                  <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                    {(["all", "draft", "published", "archived"] as const).map((st) => (
                      <button
                        key={st}
                        onClick={() => setStatusFilter(st)}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                          statusFilter === st ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        {st.charAt(0).toUpperCase() + st.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="">All Classes</option>
                    {teacherClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={subjectFilter}
                    onChange={(e) => setSubjectFilter(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="">All Subjects</option>
                    {teacherSubjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Assessment Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                  <div className="col-span-full p-8 text-center text-slate-500 bg-white border border-slate-200 rounded-xl shadow-sm">
                    Loading assessments...
                  </div>
                ) : filteredAssessments.length === 0 ? (
                  <div className="col-span-full p-12 text-center text-slate-500 bg-white border border-slate-200 rounded-xl shadow-sm">
                    No assessments found matching the filters. Click &quot;Create Assessment&quot; to get started.
                  </div>
                ) : (
                  filteredAssessments.map((a) => {
                    const statusClass =
                      a.status === "published"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                        : a.status === "archived"
                        ? "bg-rose-50 text-rose-700 border border-rose-100"
                        : "bg-slate-100 text-slate-700";

                    return (
                      <article
                        key={a.id}
                        className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow"
                      >
                        <div>
                          <div className="flex justify-between items-start mb-3">
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusClass}`}>
                              {a.status.toUpperCase()}
                            </span>
                            <span className="text-xs text-slate-400 font-bold uppercase">{a.assessment_type}</span>
                          </div>
                          <h3 className="text-base font-bold text-slate-900 mb-1">{a.title}</h3>
                          <p className="text-xs text-slate-500 mb-4 line-clamp-2">
                            {a.description || "No description provided."}
                          </p>

                          <div className="grid grid-cols-2 gap-y-2 gap-x-4 border-t border-b border-slate-100 py-3 mb-4 text-xs">
                            <div>
                              <span className="text-slate-400 font-medium">Class:</span>{" "}
                              <strong className="text-slate-700">{a.classes?.name || "Unassigned"}</strong>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium">Subject:</span>{" "}
                              <strong className="text-slate-700">{a.subjects?.name || "Unassigned"}</strong>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium">Duration:</span>{" "}
                              <strong className="text-slate-700">{a.duration} mins</strong>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium">Marks:</span>{" "}
                              <strong className="text-slate-700">{a.total_marks} marks</strong>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex justify-between items-center text-xs text-slate-500">
                            <span>Student Submissions:</span>
                            <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
                              {a.submissions_count || 0} attempt{a.submissions_count === 1 ? "" : "s"}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => openSubmissions(a.id, a.title)}
                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            View Submissions ({a.submissions_count || 0})
                          </button>

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => openEditor(a)}
                              className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDuplicateAssessment(a)}
                              className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700"
                            >
                              Duplicate
                            </button>
                            <button
                              onClick={() => handleDeleteAssessment(a.id)}
                              className="px-3 py-1.5 border border-slate-200 hover:bg-rose-50 hover:text-rose-600 rounded-lg text-xs font-semibold text-slate-700"
                            >
                              Delete
                            </button>
                            {a.status === "draft" ? (
                              <button
                                onClick={() => handleToggleStatus(a, "published")}
                                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700"
                              >
                                Publish
                              </button>
                            ) : a.status === "published" ? (
                              <button
                                onClick={() => handleToggleStatus(a, "draft")}
                                className="px-3 py-1.5 bg-yellow-600 text-white rounded-lg text-xs font-semibold hover:bg-yellow-700"
                              >
                                Unpublish
                              </button>
                            ) : (
                              <button
                                onClick={() => handleToggleStatus(a, "draft")}
                                className="px-3 py-1.5 bg-slate-600 text-white rounded-lg text-xs font-semibold hover:bg-slate-700"
                              >
                                Restore
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* 2. EDITOR VIEW */}
          {view === "editor" && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-slate-900">
                  {editingId ? "Edit Assessment" : "New Assessment"}
                </h2>
                <button
                  onClick={() => setView("dashboard")}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-100 transition-colors text-sm"
                >
                  Back to List
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Details Column */}
                <div className="lg:col-span-1 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b pb-2">Details</h3>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500">Assessment Title *</label>
                    <input
                      type="text"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500"
                      placeholder="e.g. Biology Quiz 1"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500">Description</label>
                    <textarea
                      value={formDesc}
                      onChange={(e) => setFormDesc(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500"
                      placeholder="Summary of the assessment..."
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500">Class *</label>
                      <select
                        value={formClassId}
                        onChange={(e) => setFormClassId(e.target.value)}
                        required
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-indigo-500"
                      >
                        {teacherClasses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500">Subject *</label>
                      <select
                        value={formSubjectId}
                        onChange={(e) => setFormSubjectId(e.target.value)}
                        required
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-indigo-500"
                      >
                        {teacherSubjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500">Assessment Type *</label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-indigo-500"
                    >
                      <option value="Test 1 (Week 3)">Test 1 (Week 3)</option>
                      <option value="Test 2 (Week 6)">Test 2 (Week 6)</option>
                      <option value="Test 3 (Week 9)">Test 3 (Week 9)</option>
                      <option value="Term Exam">Term Exam</option>
                      <option value="Practice Questions">Practice Questions</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500">Duration *</label>
                      <input
                        type="number"
                        min="1"
                        value={formDuration}
                        onChange={(e) => setFormDuration(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500">Total Marks</label>
                      <input
                        type="number"
                        readOnly
                        value={formTotalMarks}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500">Pass Mark *</label>
                      <input
                        type="number"
                        min="0"
                        value={formPassMark}
                        onChange={(e) => setFormPassMark(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500">Start Date</label>
                      <input
                        type="datetime-local"
                        value={formStartDate}
                        onChange={(e) => setFormStartDate(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500">End Date</label>
                      <input
                        type="datetime-local"
                        value={formEndDate}
                        onChange={(e) => setFormEndDate(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500">Instructions</label>
                    <textarea
                      rows={3}
                      value={formInstructions}
                      onChange={(e) => setFormInstructions(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500"
                      placeholder="Instructions for students..."
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <input
                      type="checkbox"
                      id="formAllowResult"
                      checked={formAllowResult}
                      onChange={(e) => setFormAllowResult(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                    />
                    <label htmlFor="formAllowResult" className="text-xs font-medium text-slate-600">
                      Students can view results immediately
                    </label>
                  </div>
                </div>

                {/* Questions Column */}
                <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                  <div className="flex justify-between items-center border-b pb-2">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                      Assessment Questions ({questions.length})
                    </h3>
                    <button
                      type="button"
                      onClick={handleAddQuestion}
                      className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                    >
                      + Add Question
                    </button>
                  </div>

                  <div className="space-y-6 divide-y divide-slate-100">
                    {questions.map((q, idx) => (
                      <div key={idx} className="pt-6 first:pt-0 space-y-4">
                        <div className="flex justify-between items-center">
                          <h4 className="font-bold text-slate-800 text-sm">Question {idx + 1}</h4>
                          <button
                            type="button"
                            onClick={() => handleRemoveQuestion(idx)}
                            className="text-xs text-rose-500 font-semibold hover:underline"
                          >
                            Delete
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="md:col-span-2 space-y-1">
                            <label className="text-xs font-semibold text-slate-500">Question Text *</label>
                            <input
                              type="text"
                              required
                              value={q.question}
                              onChange={(e) => handleUpdateQuestion(idx, "question", e.target.value)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                              placeholder="Type question content here..."
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500">Marks *</label>
                            <input
                              type="number"
                              min="1"
                              value={q.marks}
                              onChange={(e) => handleUpdateQuestion(idx, "marks", Number(e.target.value))}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500">Question Type</label>
                            <select
                              value={q.question_type}
                              onChange={(e) => {
                                const newType = e.target.value;
                                let opts = q.options;
                                let ans = q.correct_answer;
                                if (newType === "Multiple Choice") {
                                  opts = ["", "", "", ""];
                                  ans = "0";
                                } else if (newType === "True / False") {
                                  opts = ["True", "False"];
                                  ans = "True";
                                } else {
                                  opts = null;
                                  ans = "";
                                }
                                handleUpdateQuestion(idx, "question_type", newType);
                                handleUpdateQuestion(idx, "options", opts);
                                handleUpdateQuestion(idx, "correct_answer", ans);
                              }}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                            >
                              <option value="Multiple Choice">Multiple Choice</option>
                              <option value="True / False">True / False</option>
                              <option value="Fill in the Blank">Fill in the Blank</option>
                              <option value="Short Answer">Short Answer</option>
                              <option value="Essay">Essay</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            {q.question_type === "Multiple Choice" ? (
                              <div>
                                <label className="text-xs font-semibold text-slate-500 block mb-1">
                                  Options & Correct Answer *
                                </label>
                                <div className="space-y-2">
                                  {(q.options || ["", "", "", ""]).map((opt, oIdx) => (
                                    <div key={oIdx} className="flex items-center gap-2">
                                      <input
                                        type="radio"
                                        name={`correct_${idx}`}
                                        value={oIdx}
                                        checked={String(q.correct_answer) === String(oIdx)}
                                        onChange={(e) => handleUpdateQuestion(idx, "correct_answer", e.target.value)}
                                      />
                                      <input
                                        type="text"
                                        value={opt}
                                        onChange={(e) => {
                                          const updatedOpts = [...(q.options || ["", "", "", ""])];
                                          updatedOpts[oIdx] = e.target.value;
                                          handleUpdateQuestion(idx, "options", updatedOpts);
                                        }}
                                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                                        placeholder={`Option ${oIdx + 1}`}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : q.question_type === "True / False" ? (
                              <div>
                                <label className="text-xs font-semibold text-slate-500">Correct Choice *</label>
                                <select
                                  value={q.correct_answer}
                                  onChange={(e) => handleUpdateQuestion(idx, "correct_answer", e.target.value)}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                                >
                                  <option value="True">True</option>
                                  <option value="False">False</option>
                                </select>
                              </div>
                            ) : q.question_type === "Fill in the Blank" || q.question_type === "Short Answer" ? (
                              <div>
                                <label className="text-xs font-semibold text-slate-500">
                                  {q.question_type === "Fill in the Blank"
                                    ? "Correct Value (Case Insensitive) *"
                                    : "Correct Response (Sample / Rubric Keywords) *"}
                                </label>
                                <input
                                  type="text"
                                  value={q.correct_answer || ""}
                                  onChange={(e) => handleUpdateQuestion(idx, "correct_answer", e.target.value)}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                  placeholder={
                                    q.question_type === "Fill in the Blank"
                                      ? "Type target blank text"
                                      : "Keywords separated by commas"
                                  }
                                />
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400 pt-4">Essay questions are graded manually.</p>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-500">Explanation / Reference Rubric</label>
                          <textarea
                            rows={1}
                            value={q.explanation || ""}
                            onChange={(e) => handleUpdateQuestion(idx, "explanation", e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                            placeholder="Explanation or grading rubric..."
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-3 justify-end pt-4 border-t border-slate-200">
                    <button
                      type="button"
                      disabled={savingAssessment}
                      onClick={() => handleSaveAssessment("draft")}
                      className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-colors text-sm"
                    >
                      Save as Draft
                    </button>
                    <button
                      type="button"
                      disabled={savingAssessment}
                      onClick={() => handleSaveAssessment("published")}
                      className="px-5 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors text-sm shadow-sm"
                    >
                      {savingAssessment ? "Saving..." : "Publish Assessment"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. SUBMISSIONS VIEW */}
          {view === "submissions" && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Attempts — {activeAssessmentTitle}</h2>
                  <p className="text-sm text-slate-500 mt-1">Review attempts, status, and manually score essays.</p>
                </div>
                <button
                  onClick={() => setView("dashboard")}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-100 transition-colors text-sm"
                >
                  Back to List
                </button>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm text-slate-600">
                    <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4">Student</th>
                        <th className="px-6 py-4">Admission No</th>
                        <th className="px-6 py-4">Started At</th>
                        <th className="px-6 py-4">Submitted At</th>
                        <th className="px-6 py-4">Score / Max</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loadingSubmissions ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-4 text-center text-slate-500">
                            Loading attempts...
                          </td>
                        </tr>
                      ) : submissions.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-4 text-center text-slate-500">
                            No attempts have been submitted for this assessment yet.
                          </td>
                        </tr>
                      ) : (
                        submissions.map((sub) => {
                          const isGraded = sub.status === "graded";
                          return (
                            <tr key={sub.id} className="hover:bg-slate-50/50 border-b border-slate-100">
                              <td className="px-6 py-4 font-medium text-slate-900">
                                {sub.students?.name || "Unknown"}
                              </td>
                              <td className="px-6 py-4 font-mono text-xs text-slate-600">
                                {sub.students?.admission_no || "—"}
                              </td>
                              <td className="px-6 py-4 text-xs text-slate-500">
                                {sub.started_at ? new Date(sub.started_at).toLocaleString() : "—"}
                              </td>
                              <td className="px-6 py-4 text-xs text-slate-500">
                                {sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : "—"}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                {isGraded ? (
                                  <span className="text-indigo-600 font-bold">
                                    {sub.total_score} ({Math.round(sub.percentage || 0)}%)
                                  </span>
                                ) : (
                                  <span className="text-amber-600 font-medium">Pending Grading</span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                    isGraded
                                      ? "bg-emerald-50 text-emerald-800 border border-emerald-100"
                                      : "bg-amber-50 text-amber-800 border border-amber-100"
                                  }`}
                                >
                                  {sub.status.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => openGradingModal(sub)}
                                    className="px-3 py-1 bg-slate-900 text-white rounded text-xs font-semibold hover:bg-slate-800"
                                  >
                                    {isGraded ? "Review" : "Grade"}
                                  </button>
                                  {isGraded && (
                                    <button
                                      onClick={() => exportSubmissionToGradebook(sub.id)}
                                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold"
                                    >
                                      Export
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 4. UPLOADER VIEW */}
          {view === "uploader" && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Manual Score Upload</h2>
                  <p className="text-sm text-slate-500 mt-1">Upload student scores via CSV or Excel spreadsheets.</p>
                </div>
                <button
                  onClick={() => setView("dashboard")}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-100 transition-colors text-sm"
                >
                  Back to List
                </button>
              </div>

              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500">Class *</label>
                    <select
                      value={uploadClassId}
                      onChange={(e) => setUploadClassId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                      {teacherClasses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500">Subject *</label>
                    <select
                      value={uploadSubjectId}
                      onChange={(e) => setUploadSubjectId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                      {teacherSubjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Dropzone */}
                <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer relative">
                  <input
                    type="file"
                    accept=".csv, .xlsx"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleFileSelected(e.target.files[0]);
                      }
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <svg className="w-12 h-12 text-slate-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm font-semibold text-slate-700">Click to upload or drag & drop</p>
                  <p className="text-xs text-slate-500 mt-1">Accepts CSV or Excel (.xlsx) files</p>
                  <div className="text-[11px] text-indigo-600 font-medium mt-2 bg-indigo-50 inline-block px-2 py-1 rounded">
                    Required headers: Admission Number, Score, Remarks
                  </div>
                </div>

                {uploadedFileName && (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-700">{uploadedFileName}</div>
                      <div className="text-xs text-slate-500">{uploadedFileSize}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedFileName("");
                        setParsedRows([]);
                      }}
                      className="text-red-500 hover:text-red-700 text-xs font-semibold"
                    >
                      Remove
                    </button>
                  </div>
                )}

                {parsedRows.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                      Spreadsheet Preview & Validation
                    </h3>
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-h-72 overflow-y-auto">
                      <table className="w-full border-collapse text-left text-sm text-slate-600">
                        <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500 border-b border-slate-200 sticky top-0">
                          <tr>
                            <th className="px-4 py-3">Admission Number</th>
                            <th className="px-4 py-3">Score</th>
                            <th className="px-4 py-3">Remarks</th>
                            <th className="px-4 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {parsedRows.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50 border-b border-slate-100">
                              <td className="px-4 py-2 font-medium">
                                <div>{r.student_name}</div>
                                <div className="text-xs text-slate-400 font-mono">{r.admission_no}</div>
                              </td>
                              <td className="px-4 py-2">{r.score}</td>
                              <td className="px-4 py-2 text-slate-500 text-xs">{r.remarks}</td>
                              <td className={`px-4 py-2 text-xs font-semibold ${r.isValid ? "text-emerald-600" : "text-rose-600"}`}>
                                {r.statusText}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-xs font-medium text-slate-600">
                        Mapped <strong>{parsedRows.length}</strong> rows.{" "}
                        <span className={invalidRowsCount > 0 ? "text-rose-600 font-bold" : "text-emerald-600"}>
                          {invalidRowsCount} invalid rows
                        </span>
                        .
                      </div>
                      <button
                        type="button"
                        disabled={invalidRowsCount > 0 || importingScores}
                        onClick={handleSaveUploadedScores}
                        className="px-5 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors text-sm shadow-sm"
                      >
                        {importingScores ? "Importing..." : "Import Score Sheet"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 5. GRADING MODAL */}
        {isGradingOpen && activeSubmission && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Grade Attempt</h3>
                  <p className="text-xs text-slate-500">
                    Student: {activeSubmission.students?.name || "Scholar"} ({activeSubmission.students?.admission_no || "—"})
                  </p>
                </div>
                <button onClick={() => setIsGradingOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">
                  &times;
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-6 flex-1">
                {activeQuestions.map((q, idx) => {
                  const ansObj = activeAnswers.find((a) => a.question_id === q.id);
                  const studentAns = ansObj?.student_answer || "—";
                  const awarded = ansObj?.awarded_marks ?? "";
                  const feedback = ansObj?.teacher_feedback ?? "";

                  return (
                    <div key={q.id || idx} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <div className="flex justify-between items-start gap-4">
                        <h4 className="font-bold text-sm text-slate-800">
                          Q{idx + 1}. {q.question}
                        </h4>
                        <span className="text-xs bg-slate-200 px-2 py-0.5 rounded font-bold">
                          Max: {q.marks} marks
                        </span>
                      </div>

                      <div className="text-xs space-y-1">
                        <div>
                          <span className="text-slate-400 font-bold uppercase">Correct / Reference: </span>
                          <strong className="text-slate-800">{q.correct_answer}</strong>
                        </div>
                        <div>
                          <span className="text-slate-400 font-bold uppercase">Student Answer: </span>
                          <strong className="text-indigo-600">{studentAns}</strong>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 border-t border-slate-200 pt-3 mt-2 items-center">
                        <div className="sm:col-span-1 space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Score Awarded
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            max={q.marks}
                            min="0"
                            value={awarded}
                            onChange={(e) => handleUpdateAnswerScore(q.id!, q.marks, Number(e.target.value))}
                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:border-indigo-500 outline-none"
                          />
                        </div>
                        <div className="sm:col-span-3 space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Teacher Feedback
                          </label>
                          <input
                            type="text"
                            value={feedback}
                            onChange={(e) => handleUpdateAnswerFeedback(q.id!, e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:border-indigo-500 outline-none"
                            placeholder="e.g. Well formulated points..."
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50">
                <div className="text-sm font-semibold text-slate-700">
                  Total Score: <span className="text-indigo-600 font-bold">{currentGradingTotal}</span> / {gradingMaxScore}
                </div>
                <button
                  type="button"
                  disabled={savingGrades}
                  onClick={handleSaveGrades}
                  className="px-5 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors text-sm shadow-sm"
                >
                  {savingGrades ? "Saving..." : "Save & Release Grade"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
