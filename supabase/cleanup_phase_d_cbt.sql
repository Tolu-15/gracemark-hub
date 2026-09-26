-- ====================================================================
-- PHASE D: CBT / ASSESSMENT CONSOLIDATION MIGRATION
-- Source of Truth: cbt_exams, cbt_questions, cbt_submissions
-- ====================================================================

-- 1. Ensure cbt_exams has academic session and term metadata
ALTER TABLE public.cbt_exams
  ADD COLUMN IF NOT EXISTS term text NOT NULL DEFAULT 'term1',
  ADD COLUMN IF NOT EXISTS session text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE RESTRICT;

-- 2. Ensure cbt_submissions has proper foreign keys and constraints
ALTER TABLE public.cbt_submissions
  ADD COLUMN IF NOT EXISTS percentage numeric(5, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS synced_to_results boolean NOT NULL DEFAULT false;

-- 3. Safely rename legacy redundant assessment tables to _deprecated_*
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assessments') THEN
    ALTER TABLE public.assessments RENAME TO _deprecated_assessments;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assessment_submissions') THEN
    ALTER TABLE public.assessment_submissions RENAME TO _deprecated_assessment_submissions;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assessment_questions') THEN
    ALTER TABLE public.assessment_questions RENAME TO _deprecated_assessment_questions;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assessment_answers') THEN
    ALTER TABLE public.assessment_answers RENAME TO _deprecated_assessment_answers;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assessment_grading_rules') THEN
    ALTER TABLE public.assessment_grading_rules RENAME TO _deprecated_assessment_grading_rules;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cbt_score_scaling') THEN
    ALTER TABLE public.cbt_score_scaling RENAME TO _deprecated_cbt_score_scaling;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cbt_attempt_history') THEN
    ALTER TABLE public.cbt_attempt_history RENAME TO _deprecated_cbt_attempt_history;
  END IF;
END $$;
