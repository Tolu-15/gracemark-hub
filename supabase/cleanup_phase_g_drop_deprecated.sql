-- ============================================================================
-- GRACEMARK ACADEMY HUB: CLEANUP PHASE G - DROP DEPRECATED TABLES
-- Authority: Mandatory Cleanup Directive Phase G
-- ============================================================================
-- Safe drop of all deprecated legacy tables whose data has been verified 
-- and repointed to single canonical sources of truth:
--
-- 1. Phase A Unification:
--    _deprecated_teacher_assignments -> class_teacher_assignments / subject_teacher_assignments
--
-- 2. Phase D CBT Consolidation:
--    _deprecated_assessments                -> cbt_exams
--    _deprecated_assessment_questions       -> cbt_questions
--    _deprecated_assessment_submissions     -> cbt_submissions
--    _deprecated_assessment_answers         -> cbt_questions (options) & cbt_submissions (answers)
--    _deprecated_assessment_grading_rules   -> cbt_exams (total_marks/pass_mark) & gradebook
--    _deprecated_cbt_score_scaling          -> gradebook scaling
--    _deprecated_cbt_attempt_history        -> cbt_submissions
-- ============================================================================

-- 1. Teacher Assignment Legacy Tables
DROP TABLE IF EXISTS public._deprecated_teacher_assignments CASCADE;
DROP TABLE IF EXISTS public.teacher_assignments CASCADE;

-- 2. CBT / Assessment Redundant Tables
DROP TABLE IF EXISTS public._deprecated_assessment_answers CASCADE;
DROP TABLE IF EXISTS public.assessment_answers CASCADE;

DROP TABLE IF EXISTS public._deprecated_assessment_submissions CASCADE;
DROP TABLE IF EXISTS public.assessment_submissions CASCADE;

DROP TABLE IF EXISTS public._deprecated_assessment_questions CASCADE;
DROP TABLE IF EXISTS public.assessment_questions CASCADE;

DROP TABLE IF EXISTS public._deprecated_assessment_grading_rules CASCADE;
DROP TABLE IF EXISTS public.assessment_grading_rules CASCADE;

DROP TABLE IF EXISTS public._deprecated_cbt_score_scaling CASCADE;
DROP TABLE IF EXISTS public.cbt_score_scaling CASCADE;

DROP TABLE IF EXISTS public._deprecated_cbt_attempt_history CASCADE;
DROP TABLE IF EXISTS public.cbt_attempt_history CASCADE;

DROP TABLE IF EXISTS public._deprecated_assessments CASCADE;
DROP TABLE IF EXISTS public.assessments CASCADE;

-- Verify canonical tables remain intact
COMMENT ON TABLE public.class_teacher_assignments IS 'Canonical single source of truth for class teachers';
COMMENT ON TABLE public.subject_teacher_assignments IS 'Canonical single source of truth for subject teachers';
COMMENT ON TABLE public.attendance_records IS 'Canonical daily attendance source of truth';
COMMENT ON TABLE public.attendance IS 'Derived attendance summary';
COMMENT ON TABLE public.student_enrollments IS 'Canonical student session class enrollment';
COMMENT ON TABLE public.student_subject_enrollments IS 'Canonical student subject enrollment';
COMMENT ON TABLE public.cbt_exams IS 'Canonical CBT exam source of truth';
COMMENT ON TABLE public.cbt_questions IS 'Canonical CBT questions source of truth';
COMMENT ON TABLE public.cbt_submissions IS 'Canonical CBT submissions and attempts source of truth';
COMMENT ON TABLE public.results IS 'Canonical gradebook results and publication status source of truth';
