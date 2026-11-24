BEGIN;
LOCK TABLE public.attendance_records IN SHARE ROW EXCLUSIVE MODE;
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

  SELECT count(*) FILTER (WHERE am_present) + count(*) FILTER (WHERE pm_present) INTO v_present
  FROM public.attendance_records
  WHERE enrollment_id = v_enrollment_id
    AND term = v_term;

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

WITH totals AS (
  SELECT enrollment_id, term,
         count(*) FILTER (WHERE am_present) + count(*) FILTER (WHERE pm_present) AS present
  FROM public.attendance_records
  GROUP BY enrollment_id, term
)
UPDATE public.attendance_summaries s
SET times_present = t.present, times_absent = greatest(0, s.times_opened - t.present), updated_at = now()
FROM totals t
WHERE s.enrollment_id = t.enrollment_id AND s.term = t.term AND s.times_present IS DISTINCT FROM t.present;
COMMIT;