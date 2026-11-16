-- Live scores are staff working data. Students read published result snapshots via the report API.
BEGIN;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.results FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.results FROM authenticated;
DROP POLICY IF EXISTS live_scores_staff_read ON public.results;
CREATE POLICY live_scores_staff_read ON public.results AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  public.is_admin() OR (
    public.is_teacher() AND EXISTS (
      SELECT 1 FROM public.subject_teacher_assignments a
      JOIN public.academic_sessions sess ON sess.id = a.academic_session_id
      WHERE a.teacher_user_id IN (auth.uid(), (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid()))
        AND a.status = 'active' AND a.class_id = results.class_id
        AND a.subject_id = results.subject_id AND sess.name = results.session
    )
  )
);
-- Teacher opt-out reads/writes are served by the class-scoped API. The admin student
-- management page also reads this table directly.
ALTER TABLE public.student_subject_optouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS optouts_direct_staff_scope ON public.student_subject_optouts;
CREATE POLICY optouts_direct_staff_scope ON public.student_subject_optouts
  AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL PRIVILEGES ON public.student_subject_optouts FROM PUBLIC, anon;
COMMIT;
