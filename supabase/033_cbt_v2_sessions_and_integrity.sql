-- ==============================================================================
-- MIGRATION: 033_cbt_v2_sessions_and_integrity.sql
-- Upgrades the CBT exam engine to a server-authoritative design (modeled on the
-- author's separate QuizHub product): a real exam clock, one-attempt-in-flight
-- enforcement, and the columns needed for anti-cheat + resumable attempts.
-- cbt_exams/cbt_questions/cbt_submissions already existed with zero rows, so
-- this only adds columns/tables rather than migrating data.
-- ==============================================================================

ALTER TABLE public.cbt_exams
  ADD COLUMN IF NOT EXISTS attempts_allowed integer NOT NULL DEFAULT 1 CHECK (attempts_allowed BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS due_date timestamptz;

ALTER TABLE public.cbt_questions
  ADD COLUMN IF NOT EXISTS explanation text;

ALTER TABLE public.cbt_submissions
  ADD COLUMN IF NOT EXISTS tab_switches integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS integrity_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS time_taken_secs integer;

-- The exam clock. The countdown a student sees is cosmetic; this table (written
-- only by the service-role API routes) is what actually enforces expiry and
-- blocks a second concurrent attempt.
CREATE TABLE IF NOT EXISTS public.cbt_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.cbt_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  submission_id uuid REFERENCES public.cbt_submissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Exactly one open (unsubmitted) session per student per exam at a time —
-- blocks opening two tabs to attempt the same exam twice concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cbt_sessions_open
  ON public.cbt_sessions (exam_id, student_id)
  WHERE submitted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cbt_sessions_student ON public.cbt_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_cbt_sessions_exam ON public.cbt_sessions(exam_id);

ALTER TABLE public.cbt_sessions ENABLE ROW LEVEL SECURITY;

-- All real access goes through service-role API routes (same pattern as the
-- rest of this app); RLS here is defense-in-depth against a direct client query.
DROP POLICY IF EXISTS cbt_sessions_admin_all ON public.cbt_sessions;
CREATE POLICY cbt_sessions_admin_all ON public.cbt_sessions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS cbt_sessions_student_read_own ON public.cbt_sessions;
CREATE POLICY cbt_sessions_student_read_own ON public.cbt_sessions
  FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());
