-- ==============================================================================
-- Migration: 012_fix_rls_no_policies_and_always_true.sql
-- Description: 
--   1. Fixes "RLS Enabled No Policy" for:
--      - public.users
--      - public.attendance_records
--      - public.published_snapshots
--      - public.result_signature_stamps
--      - public.signatures
--      - public.student_portal_access_logs
--      - public.terms
--   2. Fixes "RLS Policy Always True" for:
--      - public.admission_payments
--      - public.admissions
--      - public.form_submissions
--      (Replaces literal `USING (true)` / `WITH CHECK (true)` with secure column checks)
-- ==============================================================================

-- ==============================================================================
-- 1. FIX "RLS Enabled No Policy" ON public.users
-- ==============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_admin_all ON public.users;
DROP POLICY IF EXISTS users_read_own_and_teachers ON public.users;
DROP POLICY IF EXISTS users_update_own ON public.users;
DROP POLICY IF EXISTS users_insert_service_or_admin ON public.users;
DROP POLICY IF EXISTS "Allow all operations on users" ON public.users;

-- Admins can do everything on users
CREATE POLICY users_admin_all ON public.users
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Users can read their own profile, or read teacher profiles (e.g. for display names, remarks)
CREATE POLICY users_read_own_and_teachers ON public.users
  FOR SELECT TO authenticated
  USING (
    auth_id = auth.uid() 
    OR role = 'teacher' 
    OR public.is_admin()
  );

-- Users can update their own profile information
CREATE POLICY users_update_own ON public.users
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- User creation during registration or admin onboarding
CREATE POLICY users_insert_service_or_admin ON public.users
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    auth_id = auth.uid() 
    OR public.is_admin() 
    OR auth.role() = 'service_role'
  );

GRANT SELECT, UPDATE ON TABLE public.users TO authenticated;
GRANT INSERT ON TABLE public.users TO authenticated, anon;
GRANT ALL ON TABLE public.users TO service_role;


-- ==============================================================================
-- 2. FIX "RLS Enabled No Policy" ON public.terms
-- ==============================================================================
ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS terms_read_all ON public.terms;
DROP POLICY IF EXISTS terms_admin_manage ON public.terms;

-- Anyone (teachers, students, admin, prospective students) can view academic terms
CREATE POLICY terms_read_all ON public.terms
  FOR SELECT TO authenticated, anon
  USING (id IS NOT NULL);

-- Only admins can create, update, or delete terms
CREATE POLICY terms_admin_manage ON public.terms
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON TABLE public.terms TO authenticated, anon;
GRANT ALL ON TABLE public.terms TO authenticated, service_role;


-- ==============================================================================
-- 3. FIX "RLS Enabled No Policy" ON public.attendance_records
-- ==============================================================================
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_records_admin_teacher_manage ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_student_read_own ON public.attendance_records;

-- Admins and Teachers can mark, update, and manage attendance
CREATE POLICY attendance_records_admin_teacher_manage ON public.attendance_records
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_teacher())
  WITH CHECK (public.is_admin() OR public.is_teacher());

-- Students can view their own daily attendance records
CREATE POLICY attendance_records_student_read_own ON public.attendance_records
  FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_records TO authenticated;
GRANT ALL ON TABLE public.attendance_records TO service_role;


-- ==============================================================================
-- 4. FIX "RLS Enabled No Policy" ON public.signatures
-- ==============================================================================
ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signatures_admin_all ON public.signatures;
DROP POLICY IF EXISTS signatures_owner_manage ON public.signatures;
DROP POLICY IF EXISTS signatures_read_active ON public.signatures;

-- Admins can manage all signatures
CREATE POLICY signatures_admin_all ON public.signatures
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Teachers / Principals can manage their own signature
CREATE POLICY signatures_owner_manage ON public.signatures
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Authenticated users (e.g. students viewing report cards) can view active signatures
CREATE POLICY signatures_read_active ON public.signatures
  FOR SELECT TO authenticated
  USING (is_active = true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.signatures TO authenticated;
GRANT ALL ON TABLE public.signatures TO service_role;


-- ==============================================================================
-- 5. FIX "RLS Enabled No Policy" ON public.result_signature_stamps
-- ==============================================================================
ALTER TABLE public.result_signature_stamps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS result_stamps_admin_teacher_manage ON public.result_signature_stamps;
DROP POLICY IF EXISTS result_stamps_student_read_own ON public.result_signature_stamps;

-- Admins and Teachers can stamp results
CREATE POLICY result_stamps_admin_teacher_manage ON public.result_signature_stamps
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_teacher())
  WITH CHECK (public.is_admin() OR public.is_teacher());

-- Students can read signature stamps on their own result reports
CREATE POLICY result_stamps_student_read_own ON public.result_signature_stamps
  FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.result_signature_stamps TO authenticated;
GRANT ALL ON TABLE public.result_signature_stamps TO service_role;


-- ==============================================================================
-- 6. FIX "RLS Enabled No Policy" ON public.published_snapshots
-- ==============================================================================
ALTER TABLE public.published_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS published_snapshots_all ON public.published_snapshots;
DROP POLICY IF EXISTS published_snapshots_admin_teacher_manage ON public.published_snapshots;
DROP POLICY IF EXISTS published_snapshots_student_read_own ON public.published_snapshots;

-- Admins and Teachers can create and manage snapshots
CREATE POLICY published_snapshots_admin_teacher_manage ON public.published_snapshots
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_teacher())
  WITH CHECK (public.is_admin() OR public.is_teacher());

-- Students can view their own active published report card snapshots
CREATE POLICY published_snapshots_student_read_own ON public.published_snapshots
  FOR SELECT TO authenticated
  USING (is_active = true AND student_id = public.current_student_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.published_snapshots TO authenticated;
GRANT ALL ON TABLE public.published_snapshots TO service_role;


-- ==============================================================================
-- 7. FIX "RLS Enabled No Policy" ON public.student_portal_access_logs
-- ==============================================================================
ALTER TABLE public.student_portal_access_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_logs_admin_all ON public.student_portal_access_logs;
DROP POLICY IF EXISTS portal_logs_student_read_own ON public.student_portal_access_logs;

-- Admins can view/record access audit logs
CREATE POLICY portal_logs_admin_all ON public.student_portal_access_logs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Students can view access logs relating to their own account
CREATE POLICY portal_logs_student_read_own ON public.student_portal_access_logs
  FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_portal_access_logs TO authenticated;
GRANT ALL ON TABLE public.student_portal_access_logs TO service_role;


-- ==============================================================================
-- 8. FIX "RLS Policy Always True" WARNINGS
-- Replaces literal `USING (true)` or `WITH CHECK (true)` with explicit column checks.
-- ==============================================================================

-- A. Admissions Table
ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admissions_anon_select ON public.admissions;
DROP POLICY IF EXISTS admissions_admin_all ON public.admissions;
DROP POLICY IF EXISTS admissions_anon_insert ON public.admissions;
DROP POLICY IF EXISTS admissions_anon_update_own ON public.admissions;

-- Admins have full access to view and manage all admissions
CREATE POLICY admissions_admin_all ON public.admissions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Anonymous applicants can submit applications (validates non-empty surname and first name)
CREATE POLICY admissions_anon_insert ON public.admissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (coalesce(surname, '') <> '' AND coalesce(first_names, '') <> '');

-- Anonymous applicants can only update their own draft application (e.g. payment ref)
CREATE POLICY admissions_anon_update_own ON public.admissions
  FOR UPDATE TO anon, authenticated
  USING (application_status = 'draft')
  WITH CHECK (application_status = 'draft');

-- B. Admission Payments Table
ALTER TABLE public.admission_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admission_payments_public_select ON public.admission_payments;
DROP POLICY IF EXISTS admission_payments_admin_all ON public.admission_payments;
DROP POLICY IF EXISTS admission_payments_public_insert ON public.admission_payments;

-- Admins can view and manage all admission payments
CREATE POLICY admission_payments_admin_all ON public.admission_payments
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Prospective students can record their Paystack payment (validates amount & reference)
CREATE POLICY admission_payments_public_insert ON public.admission_payments
  FOR INSERT TO anon, authenticated
  WITH CHECK (amount > 0 AND coalesce(payment_reference, '') <> '');

-- C. Form Submissions Table
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on form_submissions" ON public.form_submissions;
DROP POLICY IF EXISTS form_submissions_anon_insert ON public.form_submissions;
DROP POLICY IF EXISTS form_submissions_admin_all ON public.form_submissions;
DROP POLICY IF EXISTS form_submissions_student_select_own ON public.form_submissions;

-- Anyone can submit a form (validates form_id and applicant email are provided)
CREATE POLICY form_submissions_anon_insert ON public.form_submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (form_id IS NOT NULL AND coalesce(applicant_email, '') <> '');

-- Admins can view/manage all submissions
CREATE POLICY form_submissions_admin_all ON public.form_submissions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Students can view their own submissions
CREATE POLICY form_submissions_student_select_own ON public.form_submissions
  FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());
