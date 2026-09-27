-- Fixes: 'insert or update on table "attendance_summaries" violates foreign key
-- constraint "attendance_summaries_enrollment_id_fkey"' when deleting a student.
-- Deleting a student cascades to attendance_records; the per-row trigger then tried to
-- re-create a summary for an enrollment that had just been deleted. Skip that case.
-- Safe to re-run.
CREATE OR REPLACE FUNCTION public.sync_attendance_summary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment_id uuid;
  v_term public.term_code_enum;
  v_present integer;
  v_opened integer;
BEGIN
  v_enrollment_id := COALESCE(NEW.enrollment_id, OLD.enrollment_id);
  v_term := COALESCE(NEW.term, OLD.term);

  -- The enrollment is gone (student/enrollment deleted): nothing to summarise.
  IF NOT EXISTS (SELECT 1 FROM public.student_enrollments WHERE id = v_enrollment_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) INTO v_present
  FROM public.attendance_records
  WHERE enrollment_id = v_enrollment_id
    AND term = v_term
    AND (am_present = true AND pm_present = true);

  SELECT COALESCE(t.school_days, 120) INTO v_opened
  FROM public.student_enrollments se
  LEFT JOIN public.academic_terms t
    ON t.academic_session_id = se.academic_session_id AND t.term_code = v_term
  WHERE se.id = v_enrollment_id;

  IF (v_opened IS NULL OR v_opened = 0) THEN
    v_opened := 120;
  END IF;

  INSERT INTO public.attendance_summaries (enrollment_id, term, times_opened, times_present, times_absent, updated_at)
  VALUES (v_enrollment_id, v_term, v_opened, v_present, GREATEST(0, v_opened - v_present), now())
  ON CONFLICT (enrollment_id, term) DO UPDATE
  SET times_opened = EXCLUDED.times_opened,
      times_present = EXCLUDED.times_present,
      times_absent = EXCLUDED.times_absent,
      updated_at = now();

  RETURN COALESCE(NEW, OLD);
END;
$$;
