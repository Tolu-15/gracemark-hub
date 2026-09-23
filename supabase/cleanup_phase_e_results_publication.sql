-- ====================================================================
-- PHASE E: RESULT PUBLICATION UNIFICATION MIGRATION
-- Source of Truth: results.status ('draft', 'approved', 'published')
-- ====================================================================

-- 1. Ensure status check constraint on results table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'results_status_check'
      AND conrelid = 'public.results'::regclass
  ) THEN
    ALTER TABLE public.results
      ADD CONSTRAINT results_status_check
      CHECK (status IN ('draft', 'submitted', 'approved', 'published'));
  END IF;
END $$;

-- 2. Performance indexes for publication gating
CREATE INDEX IF NOT EXISTS idx_results_publication_gate
ON public.results (class_id, term, session, status);

CREATE INDEX IF NOT EXISTS idx_results_student_term_published
ON public.results (student_id, term, session, status);

-- 3. published_snapshots table performance index
CREATE INDEX IF NOT EXISTS idx_published_snapshots_lookup
ON public.published_snapshots (term, session, class_id, report_type);
