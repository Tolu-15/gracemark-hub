-- ====================================================================
-- MIGRATION: 023_assessment_frequency.sql
-- How often a subject has classwork and homework, per class subject list:
--   'weekly'      → weeks 1–10 (10 per term)
--   'fortnightly' → weeks 2, 4, 6, 8, 10 (5 per term)
-- Blank scores in those weeks count as 0 (same divisors as the Excel sheets).
-- Safe to re-run: the pre-fill only happens when the column is first added.
-- ====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subject_group_subjects' AND column_name = 'frequency'
  ) THEN
    ALTER TABLE public.subject_group_subjects
      ADD COLUMN frequency text NOT NULL DEFAULT 'fortnightly'
      CONSTRAINT chk_subject_group_subjects_frequency CHECK (frequency IN ('weekly', 'fortnightly'));

    -- Pre-fill from the Excel sheets:
    -- JSS: Mathematics and Trade weekly. SSS: English Language and Mathematics weekly.
    UPDATE public.subject_group_subjects g
    SET frequency = 'weekly'
    FROM public.subjects s
    WHERE s.id = g.subject_id
      AND (
        (g.group_code = 'JSS' AND s.name IN ('Mathematics', 'Trade'))
        OR (g.group_code <> 'JSS' AND s.name IN ('English Language', 'Mathematics'))
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
