-- ====================================================================
-- MIGRATION: 022_subject_groups_and_results_overhaul.sql
-- Gracemark Academy — Subject lists per class group, "Not offering"
-- opt-outs, frozen milestone publishing and report-card data.
--
-- Safe to re-run: every statement is idempotent.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. SUBJECT NAME TIDY-UP (match the school's Excel result sheets)
-- --------------------------------------------------------------------
UPDATE public.subjects SET name = 'Financial Accounting'  WHERE name = 'Account';
UPDATE public.subjects SET name = 'Agricultural Science'  WHERE name = 'Agric';
UPDATE public.subjects SET name = 'Further Mathematics'   WHERE name = 'Further Math';
UPDATE public.subjects SET name = 'Literature in English' WHERE name = 'Literature';

-- Merge the senior duplicates into the junior subject of the same name.
-- Every table that references subjects(id) is re-pointed. If any re-point
-- would break a unique constraint, the whole merge for that pair is rolled
-- back and both subjects are kept (a NOTICE is raised).
CREATE OR REPLACE FUNCTION pg_temp.merge_subject(p_from text, p_into text)
RETURNS void AS $$
DECLARE
  v_from uuid;
  v_into uuid;
  r record;
BEGIN
  SELECT id INTO v_from FROM public.subjects WHERE name = p_from;
  SELECT id INTO v_into FROM public.subjects WHERE name = p_into;
  IF v_from IS NULL OR v_into IS NULL OR v_from = v_into THEN
    RETURN;
  END IF;

  BEGIN
    FOR r IN
      SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'public.subjects'::regclass
    LOOP
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', r.tbl, r.col, r.col) USING v_into, v_from;
    END LOOP;

    DELETE FROM public.subjects WHERE id = v_from;
    UPDATE public.subjects SET level = 'both' WHERE id = v_into;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'Could not merge "%" into "%" (duplicate references). Both subjects were kept.', p_from, p_into;
  END;
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.merge_subject('English', 'English Language');
SELECT pg_temp.merge_subject('CRS', 'Christian Religious Studies');

-- --------------------------------------------------------------------
-- 2. SUBJECT GROUPS (JSS, SSS Science, SSS Arts, SSS Commercial)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subject_groups (
  code text PRIMARY KEY,
  name text NOT NULL,
  level public.curriculum_level_enum NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.subject_groups (code, name, level, display_order) VALUES
  ('JSS',            'Junior Secondary (JSS 1–3)', 'junior', 1),
  ('SSS_SCIENCE',    'SSS Science',                'senior', 2),
  ('SSS_ARTS',       'SSS Arts',                   'senior', 3),
  ('SSS_COMMERCIAL', 'SSS Commercial',             'senior', 4)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS subject_group_code text
  REFERENCES public.subject_groups(code) ON UPDATE CASCADE ON DELETE SET NULL;

UPDATE public.classes SET subject_group_code = CASE
    WHEN level = 'junior' OR name ILIKE 'JSS%' THEN 'JSS'
    WHEN name ILIKE '%scien%' THEN 'SSS_SCIENCE'
    WHEN name ILIKE '%art%'   THEN 'SSS_ARTS'
    WHEN name ILIKE '%comm%'  THEN 'SSS_COMMERCIAL'
  END
WHERE subject_group_code IS NULL;

CREATE TABLE IF NOT EXISTS public.subject_group_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code text NOT NULL REFERENCES public.subject_groups(code) ON UPDATE CASCADE ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  credit_unit numeric(4,1) NOT NULL DEFAULT 1 CHECK (credit_unit >= 0),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_subject_group_subject UNIQUE (group_code, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_subject_group_subjects_group ON public.subject_group_subjects(group_code);

-- Pre-fill the four lists. A list that already has subjects is left untouched.
-- Credit units come from the school's Excel G.P tables; Digital Technology and
-- Marketing are not in the Excel and start at 3 (admin can change them).
DO $$
DECLARE
  seed record;
  empty_groups text[];
BEGIN
  SELECT coalesce(array_agg(sg.code), '{}') INTO empty_groups
  FROM public.subject_groups sg
  WHERE NOT EXISTS (SELECT 1 FROM public.subject_group_subjects g WHERE g.group_code = sg.code);

  FOR seed IN
    SELECT * FROM (VALUES
      -- JSS (credit units from the JSS1 Excel sheet)
      ('JSS', 'Business Studies', 2), ('JSS', 'Christian Religious Studies', 2),
      ('JSS', 'Cultural and Creative Art', 2), ('JSS', 'Digital Technology', 2),
      ('JSS', 'English Language', 2), ('JSS', 'History', 2),
      ('JSS', 'Intermediate Science', 2), ('JSS', 'Mathematics', 5),
      ('JSS', 'Physical and Health Education', 2), ('JSS', 'Social and Citizenship Studies', 2),
      ('JSS', 'Trade', 5), ('JSS', 'Yoruba', 3),
      -- SSS Science
      ('SSS_SCIENCE', 'Agricultural Science', 3), ('SSS_SCIENCE', 'Biology', 4),
      ('SSS_SCIENCE', 'Chemistry', 4), ('SSS_SCIENCE', 'Citizenship', 2),
      ('SSS_SCIENCE', 'Digital Technology', 3), ('SSS_SCIENCE', 'Economics', 3),
      ('SSS_SCIENCE', 'English Language', 5), ('SSS_SCIENCE', 'Further Mathematics', 0),
      ('SSS_SCIENCE', 'Mathematics', 5), ('SSS_SCIENCE', 'Physics', 4),
      ('SSS_SCIENCE', 'Technical Drawing', 3), ('SSS_SCIENCE', 'Trade', 2),
      ('SSS_SCIENCE', 'Yoruba', 3),
      -- SSS Arts
      ('SSS_ARTS', 'Agricultural Science', 3), ('SSS_ARTS', 'Christian Religious Studies', 4),
      ('SSS_ARTS', 'Citizenship', 2), ('SSS_ARTS', 'Digital Technology', 3),
      ('SSS_ARTS', 'Economics', 3), ('SSS_ARTS', 'English Language', 5),
      ('SSS_ARTS', 'Government', 4), ('SSS_ARTS', 'Literature in English', 4),
      ('SSS_ARTS', 'Marketing', 3), ('SSS_ARTS', 'Mathematics', 5),
      ('SSS_ARTS', 'Trade', 2), ('SSS_ARTS', 'Yoruba', 3),
      -- SSS Commercial
      ('SSS_COMMERCIAL', 'Agricultural Science', 3), ('SSS_COMMERCIAL', 'Citizenship', 2),
      ('SSS_COMMERCIAL', 'Commerce', 4), ('SSS_COMMERCIAL', 'Digital Technology', 3),
      ('SSS_COMMERCIAL', 'Economics', 3), ('SSS_COMMERCIAL', 'English Language', 5),
      ('SSS_COMMERCIAL', 'Financial Accounting', 4), ('SSS_COMMERCIAL', 'Government', 4),
      ('SSS_COMMERCIAL', 'Marketing', 3), ('SSS_COMMERCIAL', 'Mathematics', 5),
      ('SSS_COMMERCIAL', 'Trade', 2), ('SSS_COMMERCIAL', 'Yoruba', 3)
    ) AS v(group_code, subject_name, credit_unit)
  LOOP
    IF seed.group_code = ANY (empty_groups) THEN
      INSERT INTO public.subject_group_subjects (group_code, subject_id, credit_unit)
      SELECT seed.group_code, s.id, seed.credit_unit
      FROM public.subjects s
      WHERE lower(s.name) = lower(seed.subject_name)
      ON CONFLICT (group_code, subject_id) DO NOTHING;
    END IF;
  END LOOP;

  -- Default report order: alphabetical (same as the Excel sheets)
  UPDATE public.subject_group_subjects g
  SET display_order = o.rn
  FROM (
    SELECT g2.id, row_number() OVER (PARTITION BY g2.group_code ORDER BY s.name) AS rn
    FROM public.subject_group_subjects g2
    JOIN public.subjects s ON s.id = g2.subject_id
  ) o
  WHERE o.id = g.id AND g.display_order = 0;
END $$;

-- --------------------------------------------------------------------
-- 3. "NOT OFFERING" OPT-OUTS (set by the subject teacher, per session)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_subject_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  session text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_subject_optout UNIQUE (student_id, subject_id, session)
);

CREATE INDEX IF NOT EXISTS idx_optouts_subject_session ON public.student_subject_optouts(subject_id, session);

-- --------------------------------------------------------------------
-- 4. REPORT DATA: personal skills, snapshots, attendance
-- --------------------------------------------------------------------
-- The 12 personal skills from the Excel report card, stored as
-- {"punctuality": 4, "concentration": 3, ...}
ALTER TABLE public.student_evaluations ADD COLUMN IF NOT EXISTS skills jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_evaluations_enrollment_term
  ON public.student_evaluations(enrollment_id, term);

CREATE UNIQUE INDEX IF NOT EXISTS uq_result_snapshots_enrollment_term_type
  ON public.result_snapshots(enrollment_id, term, report_type);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_summaries_enrollment_term
  ON public.attendance_summaries(enrollment_id, term);

-- --------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY for the new tables
--    (all writes go through server API routes using the service role)
-- --------------------------------------------------------------------
ALTER TABLE public.subject_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_group_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_subject_optouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subject_groups_read ON public.subject_groups;
CREATE POLICY subject_groups_read ON public.subject_groups
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS subject_group_subjects_read ON public.subject_group_subjects;
CREATE POLICY subject_group_subjects_read ON public.subject_group_subjects
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS student_subject_optouts_read ON public.student_subject_optouts;
CREATE POLICY student_subject_optouts_read ON public.student_subject_optouts
  FOR SELECT TO authenticated USING (public.is_admin() OR public.is_teacher());

NOTIFY pgrst, 'reload schema';
