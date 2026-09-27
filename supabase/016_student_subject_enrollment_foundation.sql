-- ====================================================================
-- MIGRATION: 016_student_subject_enrollment_foundation.sql
-- Gracemark Academy — Student-Level Subject Enrollment Foundation
-- Aligned with Migration 010 (academic_sessions & student_enrollments)
-- ====================================================================

-- 0. Safety Pre-check: Ensure base tables exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'students'
  ) THEN
    RAISE EXCEPTION 'Table "public.students" does not exist in this database. Please ensure you are connected to the Gracemark project (Ref: kfdfplxidvgoffqrfipw) or apply supabase/schema.sql first.';
  END IF;
END $$;

-- 1. Create student_subject_enrollments table if it does not exist
CREATE TABLE IF NOT EXISTS public.student_subject_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  session text NOT NULL DEFAULT '',
  class_id uuid REFERENCES public.classes(id) ON DELETE RESTRICT,
  enrollment_id uuid REFERENCES public.student_enrollments(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'dropped', 'exempted')),
  is_active boolean NOT NULL DEFAULT true,
  dropped_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Safely add columns if the table already existed from earlier schema drafts
ALTER TABLE public.student_subject_enrollments
  ADD COLUMN IF NOT EXISTS academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS session text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.student_enrollments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'dropped', 'exempted')),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dropped_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Ensure status is consistent with is_active
UPDATE public.student_subject_enrollments
SET status = 'dropped'
WHERE is_active = false AND (status IS NULL OR status = 'enrolled');

UPDATE public.student_subject_enrollments
SET status = 'enrolled'
WHERE status IS NULL;

-- 3. Resolve academic_session_id from session string if missing
UPDATE public.student_subject_enrollments sse
SET academic_session_id = a.id
FROM public.academic_sessions a
WHERE sse.academic_session_id IS NULL 
  AND sse.session <> '' 
  AND sse.session = a.name;

-- 4. Resolve class_id and enrollment_id from student_enrollments or students if missing
UPDATE public.student_subject_enrollments sse
SET class_id = se.class_id,
    enrollment_id = se.id
FROM public.student_enrollments se
WHERE sse.class_id IS NULL
  AND sse.student_id = se.student_id
  AND (
    (sse.academic_session_id IS NOT NULL AND sse.academic_session_id = se.academic_session_id)
    OR (sse.session <> '' AND sse.session = se.session)
  );

UPDATE public.student_subject_enrollments sse
SET class_id = s.class_id
FROM public.students s
WHERE sse.class_id IS NULL
  AND sse.student_id = s.id;

-- 5. Performance and Integrity Indexes (Non-destructive CREATE INDEX IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sse_unique_session
ON public.student_subject_enrollments (student_id, subject_id, academic_session_id)
WHERE academic_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sse_unique_legacy
ON public.student_subject_enrollments (student_id, subject_id, session)
WHERE academic_session_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sse_student ON public.student_subject_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_sse_subject ON public.student_subject_enrollments(subject_id);
CREATE INDEX IF NOT EXISTS idx_sse_class_subject ON public.student_subject_enrollments(class_id, subject_id, academic_session_id);
CREATE INDEX IF NOT EXISTS idx_sse_session_status ON public.student_subject_enrollments(academic_session_id, status);

-- 6. Safe Non-Destructive Backfill from Existing Results
-- Any student who has ever had a score recorded for a subject in results is marked as 'enrolled'
INSERT INTO public.student_subject_enrollments (
  student_id,
  subject_id,
  academic_session_id,
  session,
  class_id,
  status,
  is_active
)
SELECT DISTINCT
  r.student_id,
  r.subject_id,
  COALESCE(r.academic_session_id, a.id) AS academic_session_id,
  COALESCE(r.session, a.name, '') AS session,
  COALESCE(r.class_id, s.class_id) AS class_id,
  'enrolled' AS status,
  true AS is_active
FROM public.results r
LEFT JOIN public.academic_sessions a ON (a.name = r.session OR a.status = 'active')
LEFT JOIN public.students s ON s.id = r.student_id
WHERE r.student_id IS NOT NULL 
  AND r.subject_id IS NOT NULL
  AND (r.academic_session_id IS NOT NULL OR a.id IS NOT NULL)
ON CONFLICT DO NOTHING;

-- 7. Configure Row Level Security (RLS) safely without top-level DROP
ALTER TABLE public.student_subject_enrollments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'student_subject_enrollments' AND policyname = 'sse_admin_teacher_manage'
  ) THEN
    CREATE POLICY "sse_admin_teacher_manage" ON public.student_subject_enrollments
      FOR ALL TO authenticated
      USING (public.is_admin() OR public.is_teacher())
      WITH CHECK (public.is_admin() OR public.is_teacher());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'student_subject_enrollments' AND policyname = 'sse_student_read_own'
  ) THEN
    CREATE POLICY "sse_student_read_own" ON public.student_subject_enrollments
      FOR SELECT TO authenticated
      USING (
        public.is_admin()
        OR public.is_teacher()
        OR student_id = public.current_student_id()
      );
  END IF;
END $$;

-- 8. Grant Table Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_subject_enrollments TO authenticated;
GRANT ALL ON TABLE public.student_subject_enrollments TO service_role;
