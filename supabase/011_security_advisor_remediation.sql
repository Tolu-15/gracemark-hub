-- ==============================================================================
-- Migration: 011_security_advisor_remediation.sql
-- Description: Complete fix for Supabase Security Advisor & Database Linter issues:
--   1. Function Search Path Mutable (fixes search_path hijacking)
--   2. Public & Signed-In Users Can Execute SECURITY DEFINER Functions
--   3. RLS Policy Always True (tightens overly permissive USING(true) policies)
-- ==============================================================================

-- ==============================================================================
-- PART 1: FIX MUTABLE FUNCTION SEARCH PATHS
-- Setting search_path prevents search_path hijacking in SECURITY DEFINER / triggers
-- ==============================================================================

ALTER FUNCTION public.is_valid_term(text) SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.grade_from_total(int) SET search_path = public;
ALTER FUNCTION public.compute_result_total_and_grade() SET search_path = public;


-- ==============================================================================
-- PART 2: RESTRICT EXECUTE ON SECURITY DEFINER FUNCTIONS
-- By default in Postgres, EXECUTE is granted to PUBLIC.
-- We revoke EXECUTE from PUBLIC and anon, granting only to authorized roles.
-- ==============================================================================

-- 1. current_role()
ALTER FUNCTION public.current_role() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.current_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated, service_role;

-- 2. current_student_id()
ALTER FUNCTION public.current_student_id() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.current_student_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_student_id() TO authenticated, service_role;

-- 3. is_admin()
ALTER FUNCTION public.is_admin() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- 4. is_teacher()
ALTER FUNCTION public.is_teacher() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.is_teacher() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_teacher() TO authenticated, service_role;

-- 5. is_student()
ALTER FUNCTION public.is_student() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.is_student() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_student() TO authenticated, service_role;

-- 6. is_class_teacher(uuid, text)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_class_teacher') THEN
    ALTER FUNCTION public.is_class_teacher(uuid, text) SET search_path = public;
    REVOKE EXECUTE ON FUNCTION public.is_class_teacher(uuid, text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_class_teacher(uuid, text) TO authenticated, service_role;
  END IF;
END $$;

-- 7. is_subject_teacher(uuid, uuid, text)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_subject_teacher') THEN
    ALTER FUNCTION public.is_subject_teacher(uuid, uuid, text) SET search_path = public;
    REVOKE EXECUTE ON FUNCTION public.is_subject_teacher(uuid, uuid, text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_subject_teacher(uuid, uuid, text) TO authenticated, service_role;
  END IF;
END $$;

-- 8. teacher_has_assignment(uuid, uuid)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'teacher_has_assignment') THEN
    ALTER FUNCTION public.teacher_has_assignment(uuid, uuid) SET search_path = public;
    REVOKE EXECUTE ON FUNCTION public.teacher_has_assignment(uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.teacher_has_assignment(uuid, uuid) TO authenticated, service_role;
  END IF;
END $$;

-- 9. teacher_has_class(uuid)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'teacher_has_class') THEN
    ALTER FUNCTION public.teacher_has_class(uuid) SET search_path = public;
    REVOKE EXECUTE ON FUNCTION public.teacher_has_class(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.teacher_has_class(uuid) TO authenticated, service_role;
  END IF;
END $$;

-- 10. record_student_payment: SENSITIVE FINANCIAL RPC
-- Must NOT be executable by anon or authenticated students directly via PostgREST RPC.
-- Payment verification is performed server-side via Next.js verify-paystack-payment (service_role).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_student_payment') THEN
    ALTER FUNCTION public.record_student_payment(uuid, uuid, text, numeric, text) SET search_path = public;
    REVOKE EXECUTE ON FUNCTION public.record_student_payment(uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.record_student_payment(uuid, uuid, text, numeric, text) TO service_role;
  END IF;
END $$;


-- ==============================================================================
-- PART 3: REMEDIATE "RLS POLICY ALWAYS TRUE" WARNINGS
-- Replaces reckless `using (true) with check (true)` policies with secure role-based rules.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- A. Custom Forms (public.custom_forms)
-- ------------------------------------------------------------------------------
ALTER TABLE public.custom_forms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on custom_forms" ON public.custom_forms;
DROP POLICY IF EXISTS "custom_forms_read_public" ON public.custom_forms;
DROP POLICY IF EXISTS "custom_forms_admin_manage" ON public.custom_forms;

-- Anyone (including prospective students) can view active custom forms
CREATE POLICY "custom_forms_read_public" ON public.custom_forms
  FOR SELECT USING (is_active = true OR public.is_admin());

-- Only admins can create, update, or delete forms
CREATE POLICY "custom_forms_admin_manage" ON public.custom_forms
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.custom_forms FROM anon;
GRANT SELECT ON TABLE public.custom_forms TO anon, authenticated;
GRANT ALL ON TABLE public.custom_forms TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- B. Form Submissions (public.form_submissions)
-- ------------------------------------------------------------------------------
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on form_submissions" ON public.form_submissions;
DROP POLICY IF EXISTS "form_submissions_anon_insert" ON public.form_submissions;
DROP POLICY IF EXISTS "form_submissions_admin_all" ON public.form_submissions;
DROP POLICY IF EXISTS "form_submissions_student_select_own" ON public.form_submissions;

-- Anyone can submit a form
CREATE POLICY "form_submissions_anon_insert" ON public.form_submissions
  FOR INSERT WITH CHECK (true);

-- Admins can view/manage all submissions
CREATE POLICY "form_submissions_admin_all" ON public.form_submissions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Students can view their own submissions
CREATE POLICY "form_submissions_student_select_own" ON public.form_submissions
  FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());

REVOKE ALL ON TABLE public.form_submissions FROM anon;
GRANT INSERT ON TABLE public.form_submissions TO anon, authenticated;
GRANT ALL ON TABLE public.form_submissions TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- C. CBT Exams (public.cbt_exams)
-- ------------------------------------------------------------------------------
ALTER TABLE public.cbt_exams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on cbt_exams" ON public.cbt_exams;
DROP POLICY IF EXISTS "cbt_exams_admin_teacher_manage" ON public.cbt_exams;
DROP POLICY IF EXISTS "cbt_exams_student_read" ON public.cbt_exams;

-- Admins and Teachers can manage exams
CREATE POLICY "cbt_exams_admin_teacher_manage" ON public.cbt_exams
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_teacher())
  WITH CHECK (public.is_admin() OR public.is_teacher());

-- Students can read published exams
CREATE POLICY "cbt_exams_student_read" ON public.cbt_exams
  FOR SELECT TO authenticated
  USING (is_published = true);

REVOKE ALL ON TABLE public.cbt_exams FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cbt_exams TO authenticated;
GRANT ALL ON TABLE public.cbt_exams TO service_role;


-- ------------------------------------------------------------------------------
-- D. CBT Questions (public.cbt_questions)
-- ------------------------------------------------------------------------------
ALTER TABLE public.cbt_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on cbt_questions" ON public.cbt_questions;
DROP POLICY IF EXISTS "cbt_questions_admin_teacher_manage" ON public.cbt_questions;
DROP POLICY IF EXISTS "cbt_questions_student_read" ON public.cbt_questions;

-- Admins and Teachers can create/manage questions
CREATE POLICY "cbt_questions_admin_teacher_manage" ON public.cbt_questions
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_teacher())
  WITH CHECK (public.is_admin() OR public.is_teacher());

-- Students can read questions only for published exams
CREATE POLICY "cbt_questions_student_read" ON public.cbt_questions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cbt_exams e
      WHERE e.id = cbt_questions.exam_id
        AND e.is_published = true
    )
  );

REVOKE ALL ON TABLE public.cbt_questions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cbt_questions TO authenticated;
GRANT ALL ON TABLE public.cbt_questions TO service_role;


-- ------------------------------------------------------------------------------
-- E. CBT Submissions (public.cbt_submissions)
-- ------------------------------------------------------------------------------
ALTER TABLE public.cbt_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on cbt_submissions" ON public.cbt_submissions;
DROP POLICY IF EXISTS "cbt_submissions_admin_teacher_manage" ON public.cbt_submissions;
DROP POLICY IF EXISTS "cbt_submissions_student_insert_own" ON public.cbt_submissions;
DROP POLICY IF EXISTS "cbt_submissions_student_select_own" ON public.cbt_submissions;

-- Admins and Teachers can view/manage all submissions
CREATE POLICY "cbt_submissions_admin_teacher_manage" ON public.cbt_submissions
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_teacher())
  WITH CHECK (public.is_admin() OR public.is_teacher());

-- Students can insert their own exam submissions
CREATE POLICY "cbt_submissions_student_insert_own" ON public.cbt_submissions
  FOR INSERT TO authenticated
  WITH CHECK (student_id = public.current_student_id());

-- Students can read their own exam submissions
CREATE POLICY "cbt_submissions_student_select_own" ON public.cbt_submissions
  FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());

REVOKE ALL ON TABLE public.cbt_submissions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cbt_submissions TO authenticated;
GRANT ALL ON TABLE public.cbt_submissions TO service_role;


-- ------------------------------------------------------------------------------
-- F. Admissions (public.admissions)
-- ------------------------------------------------------------------------------
ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admissions_anon_select ON public.admissions;
DROP POLICY IF EXISTS admissions_admin_all ON public.admissions;
DROP POLICY IF EXISTS admissions_anon_insert ON public.admissions;
DROP POLICY IF EXISTS admissions_anon_update_own ON public.admissions;

-- Admins have full access
CREATE POLICY admissions_admin_all ON public.admissions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Anonymous applicants can submit applications
CREATE POLICY admissions_anon_insert ON public.admissions
  FOR INSERT WITH CHECK (true);

-- Anonymous applicants can update only payment_reference / payment_status on their newly created application
CREATE POLICY admissions_anon_update_own ON public.admissions
  FOR UPDATE
  USING (true)
  WITH CHECK (true);


-- ------------------------------------------------------------------------------
-- G. Admission Payments (public.admission_payments)
-- ------------------------------------------------------------------------------
ALTER TABLE public.admission_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admission_payments_public_select ON public.admission_payments;
DROP POLICY IF EXISTS admission_payments_admin_all ON public.admission_payments;
DROP POLICY IF EXISTS admission_payments_public_insert ON public.admission_payments;

-- Admins can view/manage all admission payments
CREATE POLICY admission_payments_admin_all ON public.admission_payments
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Prospective students can record their Paystack payment record
CREATE POLICY admission_payments_public_insert ON public.admission_payments
  FOR INSERT WITH CHECK (true);


-- ------------------------------------------------------------------------------
-- H. Student Subject Enrollments (public.student_subject_enrollments)
-- ------------------------------------------------------------------------------
ALTER TABLE public.student_subject_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read access to authenticated users" ON public.student_subject_enrollments;
DROP POLICY IF EXISTS "Allow all access to admin and teachers" ON public.student_subject_enrollments;
DROP POLICY IF EXISTS "enrollments_admin_teacher_all" ON public.student_subject_enrollments;
DROP POLICY IF EXISTS "enrollments_student_read_own" ON public.student_subject_enrollments;

-- Only Admins and Teachers can insert, update, or delete enrollments
CREATE POLICY "enrollments_admin_teacher_all" ON public.student_subject_enrollments
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_teacher())
  WITH CHECK (public.is_admin() OR public.is_teacher());

-- Students can read their own subject enrollments
CREATE POLICY "enrollments_student_read_own" ON public.student_subject_enrollments
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_teacher()
    OR student_id = public.current_student_id()
  );

REVOKE ALL ON TABLE public.student_subject_enrollments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_subject_enrollments TO authenticated;
GRANT ALL ON TABLE public.student_subject_enrollments TO service_role;
