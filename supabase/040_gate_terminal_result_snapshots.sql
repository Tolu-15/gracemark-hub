-- Students must not read Terminal Result (TR) snapshots straight from the database: TR is only
-- served by /api/student/scratch-card/view after a scratch-card view is spent. Progress reports
-- (PR1-PR3) stay readable. The app itself reads snapshots through server routes (service role),
-- so this only closes the direct-API bypass. Safe to re-run.
--
-- Rollback: recreate the policy without the report_type condition.

DROP POLICY IF EXISTS snapshots_student_read ON public.result_snapshots;
CREATE POLICY snapshots_student_read ON public.result_snapshots
  FOR SELECT TO authenticated
  USING (
    report_type::text <> 'TR'
    AND enrollment_id IN (
      SELECT se.id FROM public.student_enrollments se WHERE se.student_id = public.current_student_id()
    )
  );
