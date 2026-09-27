-- ====================================================================
-- PHASE B: ATTENDANCE UNIFICATION MIGRATION
-- Source of Truth: attendance_records (daily) & derived attendance (summary)
-- ====================================================================

-- 1. Ensure columns and constraints on attendance table
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS session text NOT NULL DEFAULT '',
  ALTER COLUMN times_opened SET DEFAULT 120;

-- 2. Ensure composite unique constraint on (student_id, term, session)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_student_term_session_key'
      AND conrelid = 'public.attendance'::regclass
  ) THEN
    -- Drop legacy constraint on (student_id, term) if it exists
    ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_student_id_term_key;
    ALTER TABLE public.attendance ADD CONSTRAINT attendance_student_term_session_key UNIQUE (student_id, term, session);
  END IF;
END $$;

-- 3. Trigger Function: Automatically recompute summary attendance from daily records
CREATE OR REPLACE FUNCTION public.recompute_daily_attendance_summary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
  v_class_id uuid;
  v_term text;
  v_session text;
  v_session_id uuid;
  v_present_count integer;
  v_total_days integer;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_student_id := OLD.student_id;
    v_class_id := OLD.class_id;
    v_term := OLD.term;
    v_session := OLD.session;
  ELSE
    v_student_id := NEW.student_id;
    v_class_id := NEW.class_id;
    v_term := NEW.term;
    v_session := NEW.session;
  END IF;

  -- Resolve academic_session_id if possible
  SELECT id INTO v_session_id FROM public.academic_sessions WHERE name = v_session LIMIT 1;

  -- Count total school days recorded for this term/session
  SELECT count(DISTINCT date) INTO v_total_days
  FROM public.attendance_records
  WHERE term = v_term AND session = v_session;

  -- Count student days present (both AM and PM present)
  SELECT count(*) INTO v_present_count
  FROM public.attendance_records
  WHERE student_id = v_student_id
    AND term = v_term
    AND session = v_session
    AND am_present = true
    AND pm_present = true;

  -- Maintain default 120 school days minimum
  v_total_days := GREATEST(120, v_total_days);

  -- Upsert derived summary
  INSERT INTO public.attendance (
    student_id,
    class_id,
    term,
    session,
    academic_session_id,
    times_opened,
    times_present,
    times_absent,
    updated_at
  )
  VALUES (
    v_student_id,
    v_class_id,
    v_term,
    v_session,
    v_session_id,
    v_total_days,
    v_present_count,
    GREATEST(0, v_total_days - v_present_count),
    now()
  )
  ON CONFLICT (student_id, term, session)
  DO UPDATE SET
    times_opened = EXCLUDED.times_opened,
    times_present = EXCLUDED.times_present,
    times_absent = EXCLUDED.times_absent,
    academic_session_id = COALESCE(EXCLUDED.academic_session_id, public.attendance.academic_session_id),
    updated_at = now();

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_attendance_summary ON public.attendance_records;
CREATE TRIGGER trg_recompute_attendance_summary
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.recompute_daily_attendance_summary();
