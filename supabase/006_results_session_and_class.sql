-- Gracemark Migration 006: Multi-Session & Class History Isolation for Results
-- Ensures results are strictly tied to student_id, subject_id, term AND session/class_id.

BEGIN;

-- 1. Add session & class_id columns to results if missing
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS session text DEFAULT '2025/2026';
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL;

-- 2. Populate class_id for existing results from student records
UPDATE public.results r
SET class_id = s.class_id
FROM public.students s
WHERE r.student_id = s.id AND r.class_id IS NULL;

-- 3. Drop legacy unique constraint on (student_id, subject_id, term)
ALTER TABLE public.results DROP CONSTRAINT IF EXISTS results_student_id_subject_id_term_key;

-- 4. Create new multi-session unique constraint
ALTER TABLE public.results DROP CONSTRAINT IF EXISTS results_student_subject_term_session_key;
ALTER TABLE public.results ADD CONSTRAINT results_student_subject_term_session_key UNIQUE (student_id, subject_id, term, session);

COMMIT;
