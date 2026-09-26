-- ====================================================================
-- PHASE A: TEACHER ASSIGNMENT UNIFICATION MIGRATION
-- Source of Truth: class_teacher_assignments & subject_teacher_assignments
-- ====================================================================

-- 1. Ensure Partial Unique Index exists on active class teacher assignments
CREATE UNIQUE INDEX IF NOT EXISTS idx_cta_unique_active
ON public.class_teacher_assignments (academic_session_id, class_id, COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid))
WHERE (status = 'active');

-- 2. Ensure Partial Unique Index exists on active subject teacher assignments
CREATE UNIQUE INDEX IF NOT EXISTS idx_sta_unique_active
ON public.subject_teacher_assignments (academic_session_id, class_id, COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid), subject_id)
WHERE (status = 'active');

-- 3. Database Trigger: Automatically sync classes.class_teacher_id from class_teacher_assignments
CREATE OR REPLACE FUNCTION public.sync_class_teacher_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF NEW.status = 'active' THEN
      UPDATE public.classes
      SET class_teacher_id = NEW.teacher_user_id
      WHERE id = NEW.class_id;
    ELSIF OLD.status = 'active' AND NEW.status <> 'active' THEN
      -- If the assignment was ended, clear class_teacher_id if it still points to this teacher
      UPDATE public.classes
      SET class_teacher_id = NULL
      WHERE id = NEW.class_id AND class_teacher_id = OLD.teacher_user_id;
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.status = 'active' THEN
      UPDATE public.classes
      SET class_teacher_id = NULL
      WHERE id = OLD.class_id AND class_teacher_id = OLD.teacher_user_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_class_teacher_id ON public.class_teacher_assignments;
CREATE TRIGGER trg_sync_class_teacher_id
AFTER INSERT OR UPDATE OR DELETE ON public.class_teacher_assignments
FOR EACH ROW EXECUTE FUNCTION public.sync_class_teacher_id();

-- 4. Deprecate legacy teacher_assignments table
-- Rename if exists, or revoke write grants
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'teacher_assignments'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = '_deprecated_teacher_assignments'
  ) THEN
    ALTER TABLE public.teacher_assignments RENAME TO _deprecated_teacher_assignments;
  END IF;
END $$;
