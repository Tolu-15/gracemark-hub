-- ==============================================================================
-- MIGRATION: 034_cbt_exams_grading_component.sql
-- Lets a CBT exam feed a specific CA grading slot (Test 1/2/3 or the Term
-- Exam), the same choice the old (never-live in production — its
-- assessments/assessment_questions/assessment_submissions tables were never
-- created there) Manage Assessments feature offered. This makes CBT Exams a
-- full replacement for it.
-- ==============================================================================

ALTER TABLE public.cbt_exams
  ADD COLUMN IF NOT EXISTS grading_component text NOT NULL DEFAULT 'exam'
    CHECK (grading_component IN ('test1', 'test2', 'test3', 'exam'));
