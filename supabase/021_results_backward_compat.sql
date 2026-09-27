-- ====================================================================
-- MIGRATION: 021_results_backward_compat.sql
-- Gracemark Academy — results table schema sync (same pattern as 020
-- applied to student_subject_enrollments, but that migration missed
-- the results table). The app's grading code (score-entry, gradebook,
-- class-broadsheet, historical-lookup, results/save, etc.) queries and
-- writes results.student_id / class_id / session / academic_session_id
-- directly, but the canonical schema only has enrollment_id. This adds
-- the columns back, backfills them, and keeps them in sync going
-- forward without requiring any application code changes.
-- ====================================================================

-- 1. Add compatibility columns to public.results
ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session text;

-- 2. The app never supplies enrollment_id when saving scores (it writes
--    student_id/class_id/session directly), so enrollment_id must be
--    optional going forward — mirroring how student_subject_enrollments
--    already works for the same reason.
ALTER TABLE public.results ALTER COLUMN enrollment_id DROP NOT NULL;

-- 3. Backfill existing rows (those that do have enrollment_id set) from
--    student_enrollments.
UPDATE public.results r
SET
  student_id = se.student_id,
  class_id = se.class_id,
  academic_session_id = se.academic_session_id,
  session = s.name
FROM public.student_enrollments se
LEFT JOIN public.academic_sessions s ON s.id = se.academic_session_id
WHERE r.enrollment_id = se.id
  AND r.student_id IS NULL;

-- 4. Trigger: whenever enrollment_id is supplied but the compat columns
--    are missing, derive them (same direction as 020's sync_sse_from_enrollment).
CREATE OR REPLACE FUNCTION public.sync_results_from_enrollment()
RETURNS trigger AS $$
BEGIN
  IF NEW.enrollment_id IS NOT NULL AND (NEW.student_id IS NULL OR NEW.class_id IS NULL) THEN
    SELECT
      se.student_id,
      se.class_id,
      se.academic_session_id,
      s.name
    INTO
      NEW.student_id,
      NEW.class_id,
      NEW.academic_session_id,
      NEW.session
    FROM public.student_enrollments se
    LEFT JOIN public.academic_sessions s ON s.id = se.academic_session_id
    WHERE se.id = NEW.enrollment_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_results_from_enrollment ON public.results;
CREATE TRIGGER trg_sync_results_from_enrollment
BEFORE INSERT OR UPDATE ON public.results
FOR EACH ROW EXECUTE FUNCTION public.sync_results_from_enrollment();

-- 5. Unique constraint matching the app's actual upsert target
--    (results/save/route.ts: onConflict "student_id,subject_id,term,session").
--    Wrapped defensively in case it already exists under a different name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_results_student_subject_term_session'
  ) THEN
    ALTER TABLE public.results
      ADD CONSTRAINT uq_results_student_subject_term_session
      UNIQUE (student_id, subject_id, term, session);
  END IF;
END $$;

-- 6. Indexes for the columns the app filters/joins on directly.
CREATE INDEX IF NOT EXISTS idx_results_student_id ON public.results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_class_id ON public.results(class_id);
CREATE INDEX IF NOT EXISTS idx_results_session ON public.results(session);

-- Note: results_teacher_select is currently just `is_teacher()` (no extra
-- scoping), so no RLS policy changes are required for the new columns to
-- work — existing policies already grant the access this fix needs.
-- results_teacher_insert/update already join through enrollment_id; since
-- enrollment_id is now nullable and the app doesn't supply it, those two
-- policies will need a follow-up separately if inserts/updates still fail
-- after this migration (out of scope for this compatibility-column fix).
