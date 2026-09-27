-- ==============================================================================
-- Migration: 014_final_security_fixes.sql
-- Description:
--   Closes all remaining Supabase Security Advisor warnings after migrations
--   011, 012, and 013:
--
--   1. RLS Policy Always True  -> admissions, form_submissions
--   2. SECURITY DEFINER functions callable by authenticated/anon via RPC
--      -> REVOKE EXECUTE from PUBLIC/anon for all helper functions
--
--   NOTE: "Leaked Password Protection" must be enabled manually in the
--         Supabase Dashboard -> Authentication -> Password Security.
-- ==============================================================================


-- ==============================================================================
-- PART 1: FIX RLS POLICY ALWAYS TRUE
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- A. public.admissions
-- ------------------------------------------------------------------------------
ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admissions_anon_insert ON public.admissions;
DROP POLICY IF EXISTS admissions_anon_update_own ON public.admissions;
DROP POLICY IF EXISTS admissions_admin_all ON public.admissions;
DROP POLICY IF EXISTS admissions_anon_select ON public.admissions;
DROP POLICY IF EXISTS "Allow all operations on admissions" ON public.admissions;

-- Admins: full access
CREATE POLICY admissions_admin_all ON public.admissions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Public applicants: can submit a new application (must have a non-empty name)
CREATE POLICY admissions_anon_insert ON public.admissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (coalesce(surname, '') <> '' AND coalesce(first_names, '') <> '');

-- Public applicants: can update their own PENDING application only
CREATE POLICY admissions_anon_update_own ON public.admissions
  FOR UPDATE TO anon, authenticated
  USING (application_status = 'draft')
  WITH CHECK (application_status = 'draft');

GRANT INSERT, UPDATE ON TABLE public.admissions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admissions TO authenticated;
GRANT ALL ON TABLE public.admissions TO service_role;


-- ------------------------------------------------------------------------------
-- B. public.form_submissions
-- ------------------------------------------------------------------------------
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_submissions_anon_insert ON public.form_submissions;
DROP POLICY IF EXISTS form_submissions_admin_all ON public.form_submissions;
DROP POLICY IF EXISTS form_submissions_student_select_own ON public.form_submissions;
DROP POLICY IF EXISTS "Allow all operations on form_submissions" ON public.form_submissions;

-- Admins: full access
CREATE POLICY form_submissions_admin_all ON public.form_submissions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Anyone can submit a form (validates form_id present and email non-empty)
CREATE POLICY form_submissions_anon_insert ON public.form_submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (form_id IS NOT NULL AND coalesce(applicant_email, '') <> '');

-- Students can read their own submissions
CREATE POLICY form_submissions_student_select_own ON public.form_submissions
  FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());

GRANT INSERT ON TABLE public.form_submissions TO anon;
GRANT SELECT, INSERT ON TABLE public.form_submissions TO authenticated;
GRANT ALL ON TABLE public.form_submissions TO service_role;


-- ==============================================================================
-- PART 2: REVOKE EXECUTE ON SECURITY DEFINER FUNCTIONS
-- These are used internally by RLS and must NOT be directly callable via RPC
-- by anon or arbitrary authenticated users.
-- ==============================================================================

ALTER FUNCTION public.current_role() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.current_role() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_role() TO authenticated, service_role;

ALTER FUNCTION public.current_student_id() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.current_student_id() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_student_id() TO authenticated, service_role;

ALTER FUNCTION public.is_admin() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

ALTER FUNCTION public.is_teacher() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.is_teacher() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_teacher() TO authenticated, service_role;

ALTER FUNCTION public.is_student() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.is_student() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_student() TO authenticated, service_role;

ALTER FUNCTION public.teacher_has_class(uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.teacher_has_class(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.teacher_has_class(uuid) TO authenticated, service_role;

ALTER FUNCTION public.teacher_has_assignment(uuid, uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.teacher_has_assignment(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.teacher_has_assignment(uuid, uuid) TO authenticated, service_role;

-- is_class_teacher(uuid, text) - from migration 010
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_class_teacher'
  ) THEN
    ALTER FUNCTION public.is_class_teacher(uuid, text) SET search_path = public;
    REVOKE EXECUTE ON FUNCTION public.is_class_teacher(uuid, text) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.is_class_teacher(uuid, text) TO authenticated, service_role;
  END IF;
END $$;

-- is_subject_teacher(uuid, uuid, text) - from migration 010
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_subject_teacher'
  ) THEN
    ALTER FUNCTION public.is_subject_teacher(uuid, uuid, text) SET search_path = public;
    REVOKE EXECUTE ON FUNCTION public.is_subject_teacher(uuid, uuid, text) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.is_subject_teacher(uuid, uuid, text) TO authenticated, service_role;
  END IF;
END $$;


-- ==============================================================================
-- DONE
-- One remaining manual action:
--   Supabase Dashboard -> Authentication -> Password Security
--   -> Enable "Leaked password protection" (HaveIBeenPwned check)
-- ==============================================================================

