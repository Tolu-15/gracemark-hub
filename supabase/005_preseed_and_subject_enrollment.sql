-- Gracemark Academy Migration 005
-- Pre-seeding JSS1-SSS3 classes & Student Subject Enrollment for Electives / Dropped Subjects

-- 1. Ensure Default School Exists (with required session column)
INSERT INTO public.schools (id, name, session)
VALUES ('00000000-0000-0000-0000-000000000001', 'Gracemark Academy', '2025/2026')
ON CONFLICT (id) DO UPDATE SET session = EXCLUDED.session;

-- 2. Pre-Seed Default Secondary Classes (JSS 1, JSS 2, JSS 3 & Senior Tracks)
INSERT INTO public.classes (school_id, name, session)
SELECT '00000000-0000-0000-0000-000000000001', c.name, '2025/2026'
FROM (VALUES
  ('JSS 1'),
  ('JSS 2'),
  ('JSS 3'),
  ('SSS 1 Science'), ('SSS 1 Arts'), ('SSS 1 Commercial'),
  ('SSS 2 Science'), ('SSS 2 Arts'), ('SSS 2 Commercial'),
  ('SSS 3 Science'), ('SSS 3 Arts'), ('SSS 3 Commercial')
) AS c(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.classes WHERE name = c.name
);

-- 3. Student Subject Enrollments (Tracks active subjects per student, supporting dropped subjects in SSS2/3)
CREATE TABLE IF NOT EXISTS public.student_subject_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  session text NOT NULL DEFAULT '2025/2026',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_student_subject_session UNIQUE (student_id, subject_id, session)
);

-- 4. RLS Policies for student_subject_enrollments
ALTER TABLE public.student_subject_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to authenticated users" ON public.student_subject_enrollments;
DROP POLICY IF EXISTS "Allow all access to admin and teachers" ON public.student_subject_enrollments;

CREATE POLICY "enrollments_admin_teacher_all" ON public.student_subject_enrollments
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_teacher())
  WITH CHECK (public.is_admin() OR public.is_teacher());

CREATE POLICY "enrollments_student_read_own" ON public.student_subject_enrollments
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_teacher()
    OR student_id = public.current_student_id()
  );
