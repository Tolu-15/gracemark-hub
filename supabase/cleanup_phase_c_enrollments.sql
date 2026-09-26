-- ====================================================================
-- PHASE C: ENROLLMENT UNIFICATION MIGRATION
-- Source of Truth: student_enrollments (class) & student_subject_enrollments (subjects)
-- ====================================================================

-- 1. Ensure all rows have academic_session_id populated before adding constraint
UPDATE public.student_subject_enrollments sse
SET academic_session_id = a.id
FROM public.academic_sessions a
WHERE sse.academic_session_id IS NULL
  AND sse.session <> ''
  AND sse.session = a.name;

-- 2. Drop partial unique indexes
DROP INDEX IF EXISTS public.idx_sse_unique_session;
DROP INDEX IF EXISTS public.idx_sse_unique_legacy;

-- 3. Create True Composite Unique Constraint on (student_id, subject_id, academic_session_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sse_student_subject_session_key'
      AND conrelid = 'public.student_subject_enrollments'::regclass
  ) THEN
    ALTER TABLE public.student_subject_enrollments
      ADD CONSTRAINT sse_student_subject_session_key UNIQUE (student_id, subject_id, academic_session_id);
  END IF;
END $$;

-- 4. Trigger to maintain students.class_id as a strictly derived cache from student_enrollments
CREATE OR REPLACE FUNCTION public.sync_student_class_from_enrollment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.status = 'active') THEN
    UPDATE public.students
    SET class_id = NEW.class_id
    WHERE id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_student_class_from_enrollment ON public.student_enrollments;
CREATE TRIGGER trg_sync_student_class_from_enrollment
AFTER INSERT OR UPDATE OF class_id, status ON public.student_enrollments
FOR EACH ROW EXECUTE FUNCTION public.sync_student_class_from_enrollment();
