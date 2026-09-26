-- Server-side enforcement of the student portal lock.
-- RESTRICTIVE policies are AND-ed with every existing permissive policy, so a locked
-- student is denied even if some older policy would have allowed the read. Admins,
-- teachers and the service role are unaffected. Fee tables (invoices, transactions,
-- fee_structures) and the student's own profile row are deliberately left readable so
-- a locked student can still see what they owe and pay. Safe to re-run.

CREATE OR REPLACE FUNCTION public.student_portal_locked()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE lower(s.portal_access_status::text) = 'locked'
      AND (
        s.user_id = auth.uid()
        OR s.user_id IN (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid())
      )
  );
$$;

REVOKE ALL ON FUNCTION public.student_portal_locked() FROM public;
GRANT EXECUTE ON FUNCTION public.student_portal_locked() TO authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'results',
    'result_snapshots',
    'published_snapshots',
    'student_evaluations',
    'attendance_records',
    'attendance_summaries',
    'student_subject_enrollments',
    'student_subject_optouts',
    'cbt_exams',
    'cbt_questions',
    'cbt_submissions',
    'assessments',
    'assessment_submissions',
    'quiz_attempts'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS portal_lock_block ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY portal_lock_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.student_portal_locked()) WITH CHECK (NOT public.student_portal_locked())',
        t
      );
    END IF;
  END LOOP;
END $$;
