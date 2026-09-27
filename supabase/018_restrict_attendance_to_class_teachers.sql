-- ==============================================================================
-- MIGRATION: 018_restrict_attendance_to_class_teachers.sql
-- Restrict Attendance Operations Strictly to Designated Class Teachers & Admins
-- ==============================================================================

-- 1. Ensure is_class_teacher helper checks both classes table and class_teacher_assignments
CREATE OR REPLACE FUNCTION public.is_class_teacher(p_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- Option A: Directly assigned on classes.class_teacher_id
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = p_class_id 
        AND c.class_teacher_id = auth.uid()
    )
    OR
    -- Option B: Assigned via class_teacher_assignments table
    EXISTS (
      SELECT 1 FROM public.class_teacher_assignments cta
      WHERE cta.class_id = p_class_id 
        AND cta.teacher_user_id = auth.uid() 
        AND cta.status = 'active'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_class_teacher(uuid) TO authenticated, service_role;

-- 2. Restrict public.attendance (Term Summary) to Admins and Class Teachers Only
DROP POLICY IF EXISTS attendance_teacher_all_for_class ON public.attendance;
DROP POLICY IF EXISTS attendance_teacher_class_teacher_only ON public.attendance;

CREATE POLICY attendance_teacher_class_teacher_only ON public.attendance
  FOR ALL TO authenticated
  USING (
    public.is_admin() OR 
    (public.is_teacher() AND public.is_class_teacher(class_id))
  )
  WITH CHECK (
    public.is_admin() OR 
    (public.is_teacher() AND public.is_class_teacher(class_id))
  );

-- 3. Restrict public.attendance_records (Daily Register) to Admins and Class Teachers Only
DROP POLICY IF EXISTS attendance_records_admin_teacher_manage ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_class_teacher_only ON public.attendance_records;

CREATE POLICY attendance_records_class_teacher_only ON public.attendance_records
  FOR ALL TO authenticated
  USING (
    public.is_admin() OR 
    (public.is_teacher() AND (
      public.is_class_teacher(class_id) OR
      EXISTS (
        SELECT 1 FROM public.students s 
        WHERE s.id = attendance_records.student_id 
          AND public.is_class_teacher(s.class_id)
      )
    ))
  )
  WITH CHECK (
    public.is_admin() OR 
    (public.is_teacher() AND (
      public.is_class_teacher(class_id) OR
      EXISTS (
        SELECT 1 FROM public.students s 
        WHERE s.id = attendance_records.student_id 
          AND public.is_class_teacher(s.class_id)
      )
    ))
  );
