  -- ====================================================================
  -- MIGRATION: 020_backward_compat_and_schema_sync.sql
  -- Gracemark Academy — Schema Synchronization & Backward Compatibility
  -- ====================================================================

  -- 1. Add compatibility columns to public.students
  ALTER TABLE public.students 
  ADD COLUMN IF NOT EXISTS name text;

  ALTER TABLE public.students 
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL;

  -- Backfill existing data
  UPDATE public.students 
  SET 
    name = COALESCE(name, full_name),
    class_id = COALESCE(class_id, current_class_id);

  -- Trigger to keep name/full_name and class_id/current_class_id in permanent sync
  CREATE OR REPLACE FUNCTION public.sync_student_compat_fields()
  RETURNS trigger AS $$
  BEGIN
    -- Sync Name
    IF NEW.full_name IS NOT NULL AND (NEW.name IS NULL OR NEW.name != NEW.full_name) THEN
      NEW.name := NEW.full_name;
    ELSIF NEW.name IS NOT NULL AND (NEW.full_name IS NULL OR NEW.full_name != NEW.name) THEN
      NEW.full_name := NEW.name;
    END IF;

    -- Sync Class ID
    IF NEW.current_class_id IS NOT NULL AND (NEW.class_id IS NULL OR NEW.class_id != NEW.current_class_id) THEN
      NEW.class_id := NEW.current_class_id;
    ELSIF NEW.class_id IS NOT NULL AND (NEW.current_class_id IS NULL OR NEW.current_class_id != NEW.class_id) THEN
      NEW.current_class_id := NEW.class_id;
    END IF;

    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_sync_student_compat_fields ON public.students;
  CREATE TRIGGER trg_sync_student_compat_fields
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.sync_student_compat_fields();


  -- 2. Add current_session to public.app_settings
  ALTER TABLE public.app_settings 
  ADD COLUMN IF NOT EXISTS current_session text;

  -- Backfill from active academic session
  UPDATE public.app_settings 
  SET current_session = (
    SELECT name FROM public.academic_sessions WHERE status = 'active' LIMIT 1
  )
  WHERE current_session IS NULL;

  -- Trigger to keep current_session and current_session_id in permanent sync
  CREATE OR REPLACE FUNCTION public.sync_app_settings_session()
  RETURNS trigger AS $$
  BEGIN
    IF NEW.current_session IS NOT NULL THEN
      SELECT id INTO NEW.current_session_id 
      FROM public.academic_sessions 
      WHERE name = NEW.current_session 
      LIMIT 1;
    ELSIF NEW.current_session_id IS NOT NULL THEN
      SELECT name INTO NEW.current_session 
      FROM public.academic_sessions 
      WHERE id = NEW.current_session_id 
      LIMIT 1;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_sync_app_settings_session ON public.app_settings;
  CREATE TRIGGER trg_sync_app_settings_session
  BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.sync_app_settings_session();

  -- 3. Add personal_email to public.users
  ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS personal_email text;

  -- 4. Add compatibility columns to teacher assignments tables
  ALTER TABLE public.class_teacher_assignments 
  ADD COLUMN IF NOT EXISTS session text,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

  ALTER TABLE public.subject_teacher_assignments 
  ADD COLUMN IF NOT EXISTS session text,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

  -- Backfill session text from academic_sessions
  UPDATE public.class_teacher_assignments cta
  SET 
    session = s.name,
    start_date = cta.assigned_at::date,
    end_date = cta.ended_at::date,
    created_at = COALESCE(cta.created_at, cta.assigned_at)
  FROM public.academic_sessions s
  WHERE cta.academic_session_id = s.id AND cta.session IS NULL;

  UPDATE public.subject_teacher_assignments sta
  SET 
    session = s.name,
    start_date = sta.assigned_at::date,
    end_date = sta.ended_at::date,
    created_at = COALESCE(sta.created_at, sta.assigned_at)
  FROM public.academic_sessions s
  WHERE sta.academic_session_id = s.id AND sta.session IS NULL;

  -- 5. Add compatibility columns & foreign keys to student_subject_enrollments
  ALTER TABLE public.student_subject_enrollments 
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS session text;

  -- Backfill from student_enrollments
  UPDATE public.student_subject_enrollments sse
  SET 
    student_id = se.student_id,
    class_id = se.class_id,
    academic_session_id = se.academic_session_id,
    session = s.name
  FROM public.student_enrollments se
  LEFT JOIN public.academic_sessions s ON s.id = se.academic_session_id
  WHERE sse.enrollment_id = se.id
    AND sse.student_id IS NULL;

  -- Trigger to keep student_id, class_id, and academic_session_id in sync
  CREATE OR REPLACE FUNCTION public.sync_sse_from_enrollment()
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

  DROP TRIGGER IF EXISTS trg_sync_sse_from_enrollment ON public.student_subject_enrollments;
  CREATE TRIGGER trg_sync_sse_from_enrollment
  BEFORE INSERT OR UPDATE ON public.student_subject_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.sync_sse_from_enrollment();



