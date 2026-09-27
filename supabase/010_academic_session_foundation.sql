-- ====================================================================
-- MIGRATION: 010_academic_session_foundation.sql
-- Gracemark Academy — Academic Session Foundation & Relationship Redesign
-- ====================================================================

-- 1. Sections Table (Optional class subdivisions e.g., JSS 1-A, SS 1-Science)
CREATE TABLE IF NOT EXISTS public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, name)
);
CREATE INDEX IF NOT EXISTS idx_sections_class_id ON public.sections(class_id);

-- 2. Student Enrollments Table (Canonical source of student placement per session)
CREATE TABLE IF NOT EXISTS public.student_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  session text NOT NULL DEFAULT '',
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'promoted', 'repeated', 'graduated', 'withdrawn')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, academic_session_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_session ON public.student_enrollments(academic_session_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class ON public.student_enrollments(class_id);

-- 3. Class Teacher Assignments Table (Class-level responsibility: attendance, remarks, student care)
CREATE TABLE IF NOT EXISTS public.class_teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  session text NOT NULL DEFAULT '',
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  teacher_user_id uuid NOT NULL, -- auth.users.id
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  start_date date NOT NULL DEFAULT current_date,
  end_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cta_teacher ON public.class_teacher_assignments(teacher_user_id);
CREATE INDEX IF NOT EXISTS idx_cta_session ON public.class_teacher_assignments(academic_session_id);
CREATE INDEX IF NOT EXISTS idx_cta_class ON public.class_teacher_assignments(class_id);

-- Unique index: Only ONE active Class Teacher per (academic_session, class, section)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cta_unique_active
ON public.class_teacher_assignments (academic_session_id, class_id, COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid))
WHERE (status = 'active');

-- 4. Subject Teacher Assignments Table (Subject-level teaching and score entry)
CREATE TABLE IF NOT EXISTS public.subject_teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  session text NOT NULL DEFAULT '',
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  teacher_user_id uuid NOT NULL, -- auth.users.id
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  start_date date NOT NULL DEFAULT current_date,
  end_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sta_teacher ON public.subject_teacher_assignments(teacher_user_id);
CREATE INDEX IF NOT EXISTS idx_sta_session ON public.subject_teacher_assignments(academic_session_id);
CREATE INDEX IF NOT EXISTS idx_sta_class ON public.subject_teacher_assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_sta_subject ON public.subject_teacher_assignments(subject_id);

-- Unique index: Only ONE active Subject Teacher per (academic_session, class, section, subject)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sta_unique_active
ON public.subject_teacher_assignments (academic_session_id, class_id, COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid), subject_id)
WHERE (status = 'active');

-- 5. Add user/student identity & password reset columns
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS staff_id text UNIQUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS personal_email text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE public.results ADD COLUMN IF NOT EXISTS academic_session_id uuid REFERENCES public.academic_sessions(id);
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.student_enrollments(id);

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS academic_session_id uuid REFERENCES public.academic_sessions(id);
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.student_enrollments(id);

-- 6. Table Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sections TO authenticated;
GRANT ALL ON TABLE public.sections TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_enrollments TO authenticated;
GRANT ALL ON TABLE public.student_enrollments TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.class_teacher_assignments TO authenticated;
GRANT ALL ON TABLE public.class_teacher_assignments TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subject_teacher_assignments TO authenticated;
GRANT ALL ON TABLE public.subject_teacher_assignments TO service_role;

-- 7. Helper Security Functions for RLS & Access Control
CREATE OR REPLACE FUNCTION public.is_class_teacher(p_class_id uuid, p_session text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.class_teacher_assignments cta
    WHERE cta.teacher_user_id = auth.uid()
      AND cta.class_id = p_class_id
      AND cta.status = 'active'
      AND (p_session IS NULL OR cta.session = p_session)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_subject_teacher(p_class_id uuid, p_subject_id uuid, p_session text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subject_teacher_assignments sta
    WHERE sta.teacher_user_id = auth.uid()
      AND sta.class_id = p_class_id
      AND sta.subject_id = p_subject_id
      AND sta.status = 'active'
      AND (p_session IS NULL OR sta.session = p_session)
  );
$$;

-- 8. Enable Row Level Security (RLS)
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_teacher_assignments ENABLE ROW LEVEL SECURITY;

-- Sections Policies
DROP POLICY IF EXISTS sections_admin_all ON public.sections;
CREATE POLICY sections_admin_all ON public.sections FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS sections_read_auth ON public.sections;
CREATE POLICY sections_read_auth ON public.sections FOR SELECT TO authenticated USING (true);

-- Student Enrollments Policies
DROP POLICY IF EXISTS enrollments_admin_all ON public.student_enrollments;
CREATE POLICY enrollments_admin_all ON public.student_enrollments FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS enrollments_student_read_own ON public.student_enrollments;
CREATE POLICY enrollments_student_read_own ON public.student_enrollments FOR SELECT USING (
  public.is_student() AND student_id = public.current_student_id()
);

DROP POLICY IF EXISTS enrollments_teacher_read ON public.student_enrollments;
CREATE POLICY enrollments_teacher_read ON public.student_enrollments FOR SELECT USING (
  public.is_teacher() AND (
    public.is_class_teacher(class_id, session) OR
    EXISTS (
      SELECT 1 FROM public.subject_teacher_assignments sta
      WHERE sta.teacher_user_id = auth.uid() AND sta.class_id = student_enrollments.class_id AND sta.status = 'active'
    )
  )
);

-- Class Teacher Assignments Policies
DROP POLICY IF EXISTS cta_admin_all ON public.class_teacher_assignments;
CREATE POLICY cta_admin_all ON public.class_teacher_assignments FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS cta_read_auth ON public.class_teacher_assignments;
CREATE POLICY cta_read_auth ON public.class_teacher_assignments FOR SELECT TO authenticated USING (true);

-- Subject Teacher Assignments Policies
DROP POLICY IF EXISTS sta_admin_all ON public.subject_teacher_assignments;
CREATE POLICY sta_admin_all ON public.subject_teacher_assignments FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS sta_read_auth ON public.subject_teacher_assignments;
CREATE POLICY sta_read_auth ON public.subject_teacher_assignments FOR SELECT TO authenticated USING (true);

-- 9. SAFE ZERO-DATA-LOSS BACKFILL
DO $$
DECLARE
  v_session_id uuid;
  v_session_name text;
BEGIN
  -- Determine current active session
  SELECT id, name INTO v_session_id, v_session_name
  FROM public.academic_sessions
  WHERE is_current = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_session_id IS NULL THEN
    SELECT id, name INTO v_session_id, v_session_name
    FROM public.academic_sessions
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_session_id IS NOT NULL THEN
    -- Backfill all 19 students into student_enrollments for the active session
    INSERT INTO public.student_enrollments (student_id, academic_session_id, session, class_id, status)
    SELECT s.id, v_session_id, v_session_name, s.class_id, 'active'
    FROM public.students s
    WHERE s.class_id IS NOT NULL
    ON CONFLICT (student_id, academic_session_id) DO UPDATE
    SET class_id = EXCLUDED.class_id, session = EXCLUDED.session;

    -- Backfill existing teacher_assignments into subject_teacher_assignments
    INSERT INTO public.subject_teacher_assignments (
      academic_session_id, session, class_id, subject_id, teacher_user_id, status, start_date
    )
    SELECT
      v_session_id,
      v_session_name,
      ta.class_id,
      ta.subject_id,
      ta.teacher_user_id,
      'active',
      CURRENT_DATE
    FROM public.teacher_assignments ta
    WHERE ta.class_id IS NOT NULL AND ta.subject_id IS NOT NULL AND ta.teacher_user_id IS NOT NULL
    ON CONFLICT DO NOTHING;

    -- Backfill classes.class_teacher_id into class_teacher_assignments if any exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'classes' AND column_name = 'class_teacher_id'
    ) THEN
      INSERT INTO public.class_teacher_assignments (
        academic_session_id, session, class_id, teacher_user_id, status, start_date
      )
      SELECT
        v_session_id,
        v_session_name,
        c.id,
        c.class_teacher_id,
        'active',
        CURRENT_DATE
      FROM public.classes c
      WHERE c.class_teacher_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END $$;
