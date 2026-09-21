-- ==============================================================================
-- Migration: 013_fix_rls_initplan_and_multiple_policies.sql
-- Description:
--   Resolves all ~70 Supabase Advisor Performance & RLS warnings:
--   1. auth_rls_initplan: Wraps auth.uid() / auth.role() in (SELECT auth.<func>())
--      so Postgres evaluates it ONCE per query (InitPlan) instead of per-row.
--   2. multiple_permissive_policies: Consolidates duplicate / overlapping RLS
--      policies on the same tables for the same roles.
-- ==============================================================================

-- ==============================================================================
-- PART 1: CORE TABLES (schools, classes, subjects, students, etc.)
-- ==============================================================================

-- 1. schools
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schools_admin_all ON public.schools;
DROP POLICY IF EXISTS schools_read_authenticated ON public.schools;

CREATE POLICY schools_admin_all ON public.schools
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY schools_read_authenticated ON public.schools
  FOR SELECT TO authenticated
  USING (true);

-- 2. classes
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS classes_admin_all ON public.classes;
DROP POLICY IF EXISTS classes_teacher_read ON public.classes;
DROP POLICY IF EXISTS classes_student_read ON public.classes;
DROP POLICY IF EXISTS classes_read_authenticated ON public.classes;

CREATE POLICY classes_admin_all ON public.classes
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY classes_read_authenticated ON public.classes
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (public.is_teacher() AND public.teacher_has_class(id))
    OR (
      public.is_student() 
      AND id = (SELECT s.class_id FROM public.students s WHERE s.user_id = (SELECT auth.uid()) LIMIT 1)
    )
  );

-- 3. subjects
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subjects_admin_all ON public.subjects;
DROP POLICY IF EXISTS subjects_read_authenticated ON public.subjects;

CREATE POLICY subjects_admin_all ON public.subjects
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY subjects_read_authenticated ON public.subjects
  FOR SELECT TO authenticated
  USING (true);

-- 4. students
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS students_admin_all ON public.students;
DROP POLICY IF EXISTS students_teacher_read ON public.students;
DROP POLICY IF EXISTS students_student_read_own ON public.students;
DROP POLICY IF EXISTS "Allow all operations on students" ON public.students;

CREATE POLICY students_admin_all ON public.students
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY students_read_authorized ON public.students
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (public.is_teacher() AND public.teacher_has_class(class_id))
    OR (user_id = (SELECT auth.uid()))
  );

-- 5. teacher_assignments
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teacher_assignments_admin_all ON public.teacher_assignments;
DROP POLICY IF EXISTS teacher_assignments_teacher_read ON public.teacher_assignments;

CREATE POLICY teacher_assignments_admin_all ON public.teacher_assignments
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY teacher_assignments_read_authorized ON public.teacher_assignments
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (teacher_user_id = (SELECT auth.uid()))
  );

-- 6. results
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS results_admin_all ON public.results;
DROP POLICY IF EXISTS results_teacher_write ON public.results;
DROP POLICY IF EXISTS results_teacher_update ON public.results;
DROP POLICY IF EXISTS results_teacher_all ON public.results;
DROP POLICY IF EXISTS results_authenticated_all ON public.results;
DROP POLICY IF EXISTS results_student_read_own ON public.results;
DROP POLICY IF EXISTS results_read_authorized ON public.results;
DROP POLICY IF EXISTS results_modify_authorized ON public.results;

CREATE POLICY results_read_authorized ON public.results
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      public.is_teacher() 
      AND EXISTS (
        SELECT 1 FROM public.students s 
        WHERE s.id = results.student_id 
          AND public.teacher_has_assignment(s.class_id, results.subject_id)
      )
    )
    OR (
      public.is_student() 
      AND student_id = public.current_student_id()
    )
  );

CREATE POLICY results_modify_authorized ON public.results
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR (
      public.is_teacher() 
      AND EXISTS (
        SELECT 1 FROM public.students s 
        WHERE s.id = results.student_id 
          AND public.teacher_has_assignment(s.class_id, results.subject_id)
      )
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_teacher() 
      AND EXISTS (
        SELECT 1 FROM public.students s 
        WHERE s.id = results.student_id 
          AND public.teacher_has_assignment(s.class_id, results.subject_id)
      )
    )
  );

-- 7. class_averages
ALTER TABLE public.class_averages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS class_averages_admin_all ON public.class_averages;
DROP POLICY IF EXISTS class_averages_teacher_read ON public.class_averages;
DROP POLICY IF EXISTS class_averages_student_read ON public.class_averages;

CREATE POLICY class_averages_admin_all ON public.class_averages
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY class_averages_read_authorized ON public.class_averages
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (public.is_teacher() AND public.teacher_has_assignment(class_id, subject_id))
    OR (
      public.is_student() 
      AND class_id = (SELECT s.class_id FROM public.students s WHERE s.user_id = (SELECT auth.uid()) LIMIT 1)
    )
  );

-- 8. student_enrollments
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'student_enrollments' AND schemaname = 'public') THEN
    DROP POLICY IF EXISTS enrollments_teacher_read ON public.student_enrollments;
    CREATE POLICY enrollments_teacher_read ON public.student_enrollments
      FOR SELECT TO authenticated
      USING (
        public.is_admin()
        OR (
          public.is_teacher() AND (
            public.is_class_teacher(class_id, session)
            OR EXISTS (
              SELECT 1 FROM public.subject_teacher_assignments sta
              WHERE sta.teacher_user_id = (SELECT auth.uid()) 
                AND sta.class_id = student_enrollments.class_id 
                AND sta.status = 'active'
            )
          )
        )
      );
  END IF;
END $$;

-- 9. alumni_students
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'alumni_students' AND schemaname = 'public') THEN
    DROP POLICY IF EXISTS alumni_admin_all ON public.alumni_students;
    DROP POLICY IF EXISTS alumni_read_authenticated ON public.alumni_students;

    CREATE POLICY alumni_admin_all ON public.alumni_students
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());

    CREATE POLICY alumni_read_authenticated ON public.alumni_students
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- 10. app_settings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'app_settings' AND schemaname = 'public') THEN
    DROP POLICY IF EXISTS app_settings_admin_all ON public.app_settings;
    DROP POLICY IF EXISTS app_settings_read_authenticated ON public.app_settings;

    CREATE POLICY app_settings_admin_all ON public.app_settings
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());

    CREATE POLICY app_settings_read_authenticated ON public.app_settings
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- 11. fee_structures
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'fee_structures' AND schemaname = 'public') THEN
    DROP POLICY IF EXISTS fee_structures_admin_all ON public.fee_structures;
    DROP POLICY IF EXISTS fee_structures_read_auth ON public.fee_structures;

    CREATE POLICY fee_structures_admin_all ON public.fee_structures
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());

    CREATE POLICY fee_structures_read_auth ON public.fee_structures
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;


-- ==============================================================================
-- PART 2: ASSESSMENTS & QUIZ MODULE
-- Consolidates multiple overlapping policies and uses (SELECT auth.uid())
-- ==============================================================================

-- 1. assessments
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assessments_admin_all ON public.assessments;
DROP POLICY IF EXISTS assessments_teacher_manage ON public.assessments;
DROP POLICY IF EXISTS assessments_student_read ON public.assessments;

CREATE POLICY assessments_admin_all ON public.assessments
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY assessments_teacher_manage ON public.assessments
  FOR ALL TO authenticated
  USING (public.is_teacher() AND teacher_id = (SELECT auth.uid()))
  WITH CHECK (public.is_teacher() AND teacher_id = (SELECT auth.uid()));

CREATE POLICY assessments_student_read ON public.assessments
  FOR SELECT TO authenticated
  USING (public.is_student() AND status = 'published');

-- 2. assessment_questions
ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS questions_admin_all ON public.assessment_questions;
DROP POLICY IF EXISTS questions_teacher_manage ON public.assessment_questions;
DROP POLICY IF EXISTS questions_student_read ON public.assessment_questions;

CREATE POLICY questions_admin_all ON public.assessment_questions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY questions_teacher_manage ON public.assessment_questions
  FOR ALL TO authenticated
  USING (
    public.is_teacher() 
    AND EXISTS (
      SELECT 1 FROM public.assessments a 
      WHERE a.id = assessment_questions.assessment_id AND a.teacher_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    public.is_teacher() 
    AND EXISTS (
      SELECT 1 FROM public.assessments a 
      WHERE a.id = assessment_questions.assessment_id AND a.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY questions_student_read ON public.assessment_questions
  FOR SELECT TO authenticated
  USING (
    public.is_student() 
    AND EXISTS (
      SELECT 1 FROM public.assessments a 
      WHERE a.id = assessment_questions.assessment_id AND a.status = 'published'
    )
  );

-- 3. assessment_submissions
ALTER TABLE public.assessment_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS submissions_admin_all ON public.assessment_submissions;
DROP POLICY IF EXISTS submissions_teacher_view_grade ON public.assessment_submissions;
DROP POLICY IF EXISTS submissions_student_own ON public.assessment_submissions;

CREATE POLICY submissions_admin_all ON public.assessment_submissions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY submissions_teacher_view_grade ON public.assessment_submissions
  FOR ALL TO authenticated
  USING (
    public.is_teacher() 
    AND EXISTS (
      SELECT 1 FROM public.assessments a 
      WHERE a.id = assessment_submissions.assessment_id AND a.teacher_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    public.is_teacher() 
    AND EXISTS (
      SELECT 1 FROM public.assessments a 
      WHERE a.id = assessment_submissions.assessment_id AND a.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY submissions_student_own ON public.assessment_submissions
  FOR ALL TO authenticated
  USING (public.is_student() AND student_id = public.current_student_id())
  WITH CHECK (public.is_student() AND student_id = public.current_student_id());

-- 4. assessment_answers
ALTER TABLE public.assessment_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS answers_admin_all ON public.assessment_answers;
DROP POLICY IF EXISTS answers_teacher_view_grade ON public.assessment_answers;
DROP POLICY IF EXISTS answers_student_own ON public.assessment_answers;

CREATE POLICY answers_admin_all ON public.assessment_answers
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY answers_teacher_view_grade ON public.assessment_answers
  FOR ALL TO authenticated
  USING (
    public.is_teacher() 
    AND EXISTS (
      SELECT 1 FROM public.assessment_submissions s
      JOIN public.assessments a ON s.assessment_id = a.id
      WHERE s.id = assessment_answers.submission_id AND a.teacher_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    public.is_teacher() 
    AND EXISTS (
      SELECT 1 FROM public.assessment_submissions s
      JOIN public.assessments a ON s.assessment_id = a.id
      WHERE s.id = assessment_answers.submission_id AND a.teacher_id = (SELECT auth.uid())
    )
  );

CREATE POLICY answers_student_own ON public.assessment_answers
  FOR ALL TO authenticated
  USING (
    public.is_student() 
    AND EXISTS (
      SELECT 1 FROM public.assessment_submissions s
      WHERE s.id = assessment_answers.submission_id AND s.student_id = public.current_student_id()
    )
  )
  WITH CHECK (
    public.is_student() 
    AND EXISTS (
      SELECT 1 FROM public.assessment_submissions s
      WHERE s.id = assessment_answers.submission_id AND s.student_id = public.current_student_id()
    )
  );

-- 5. assessment_grading_rules
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'assessment_grading_rules' AND schemaname = 'public') THEN
    DROP POLICY IF EXISTS grading_rules_admin_all ON public.assessment_grading_rules;
    DROP POLICY IF EXISTS grading_rules_teacher_all ON public.assessment_grading_rules;
    DROP POLICY IF EXISTS grading_rules_read_authenticated ON public.assessment_grading_rules;

    CREATE POLICY grading_rules_admin_teacher ON public.assessment_grading_rules
      FOR ALL TO authenticated
      USING (public.is_admin() OR public.is_teacher())
      WITH CHECK (public.is_admin() OR public.is_teacher());

    CREATE POLICY grading_rules_read_authenticated ON public.assessment_grading_rules
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- 6. uploaded_scores
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'uploaded_scores' AND schemaname = 'public') THEN
    DROP POLICY IF EXISTS uploaded_scores_admin_all ON public.uploaded_scores;
    DROP POLICY IF EXISTS uploaded_scores_teacher_manage ON public.uploaded_scores;

    CREATE POLICY uploaded_scores_admin_all ON public.uploaded_scores
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());

    CREATE POLICY uploaded_scores_teacher_manage ON public.uploaded_scores
      FOR ALL TO authenticated
      USING (public.is_teacher() AND teacher_id = (SELECT auth.uid()))
      WITH CHECK (public.is_teacher() AND teacher_id = (SELECT auth.uid()));
  END IF;
END $$;


-- ==============================================================================
-- PART 3: ATTENDANCE & CBT MODULES
-- ==============================================================================

-- 1. attendance (legacy table)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'attendance' AND schemaname = 'public') THEN
    DROP POLICY IF EXISTS attendance_admin_all ON public.attendance;
    DROP POLICY IF EXISTS attendance_teacher_all_for_class ON public.attendance;
    DROP POLICY IF EXISTS attendance_student_read_own ON public.attendance;

    CREATE POLICY attendance_admin_all ON public.attendance
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());

    CREATE POLICY attendance_teacher_all_for_class ON public.attendance
      FOR ALL TO authenticated
      USING (public.is_teacher() AND public.teacher_has_class(class_id))
      WITH CHECK (public.is_teacher() AND public.teacher_has_class(class_id));

    CREATE POLICY attendance_student_read_own ON public.attendance
      FOR SELECT TO authenticated
      USING (public.is_student() AND student_id = public.current_student_id());
  END IF;
END $$;

-- 2. cbt_attempt_history
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'cbt_attempt_history' AND schemaname = 'public') THEN
    DROP POLICY IF EXISTS attempt_history_admin_all ON public.cbt_attempt_history;
    DROP POLICY IF EXISTS attempt_history_teacher_all ON public.cbt_attempt_history;
    DROP POLICY IF EXISTS attempt_history_student_own ON public.cbt_attempt_history;

    CREATE POLICY attempt_history_admin_teacher ON public.cbt_attempt_history
      FOR ALL TO authenticated
      USING (public.is_admin() OR public.is_teacher())
      WITH CHECK (public.is_admin() OR public.is_teacher());

    CREATE POLICY attempt_history_student_own ON public.cbt_attempt_history
      FOR ALL TO authenticated
      USING (
        public.is_student()
        AND EXISTS (
          SELECT 1 FROM public.assessment_submissions sub
          WHERE sub.id = cbt_attempt_history.submission_id
            AND sub.student_id = public.current_student_id()
        )
      )
      WITH CHECK (
        public.is_student()
        AND EXISTS (
          SELECT 1 FROM public.assessment_submissions sub
          WHERE sub.id = cbt_attempt_history.submission_id
            AND sub.student_id = public.current_student_id()
        )
      );
  END IF;
END $$;

-- 3. cbt_score_scaling
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'cbt_score_scaling' AND schemaname = 'public') THEN
    DROP POLICY IF EXISTS cbt_scaling_admin_all ON public.cbt_score_scaling;
    DROP POLICY IF EXISTS cbt_scaling_teacher_all ON public.cbt_score_scaling;
    DROP POLICY IF EXISTS cbt_scaling_read ON public.cbt_score_scaling;

    CREATE POLICY cbt_scaling_admin_teacher ON public.cbt_score_scaling
      FOR ALL TO authenticated
      USING (public.is_admin() OR public.is_teacher())
      WITH CHECK (public.is_admin() OR public.is_teacher());

    CREATE POLICY cbt_scaling_read ON public.cbt_score_scaling
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- 4. admission_forms
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'admission_forms' AND schemaname = 'public') THEN
    DROP POLICY IF EXISTS admission_forms_admin_all ON public.admission_forms;
    DROP POLICY IF EXISTS admission_forms_public_read ON public.admission_forms;

    CREATE POLICY admission_forms_admin_all ON public.admission_forms
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());

    CREATE POLICY admission_forms_public_read ON public.admission_forms
      FOR SELECT TO anon, authenticated
      USING (status = 'active' OR public.is_admin());
  END IF;
END $$;
