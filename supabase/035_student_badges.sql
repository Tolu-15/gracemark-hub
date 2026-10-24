-- ==============================================================================
-- MIGRATION: 035_student_badges.sql
-- Position-based achievement badges. Awarded automatically at publish time
-- for the top 3 positions in a student's year level (position already ranks
-- across the whole level, e.g. all three SSS1 arms combined — see
-- applyLevelWidePositions in reportBuilder.ts). One badge per student per
-- term/session/level: a republish that changes a student's position
-- upserts or removes the row to stay accurate.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.student_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  badge_type text NOT NULL CHECK (badge_type IN ('position_1', 'position_2', 'position_3')),
  level_name text NOT NULL,
  class_name text NOT NULL,
  position integer NOT NULL,
  ranked_count integer,
  term text NOT NULL,
  session text NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, term, session, level_name)
);

CREATE INDEX IF NOT EXISTS idx_student_badges_student ON public.student_badges(student_id);

ALTER TABLE public.student_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_badges_admin_all ON public.student_badges;
CREATE POLICY student_badges_admin_all ON public.student_badges
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS student_badges_student_read_own ON public.student_badges;
CREATE POLICY student_badges_student_read_own ON public.student_badges
  FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());
