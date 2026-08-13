-- Gracemark Academy — Hard Reset & Clean Class Setup Script for Testing
-- WARNING: This will remove all test data (students, results, evaluations, attendance, teacher assignments, payments, CBT)
-- AND restore strictly the 12 clean pre-seeded secondary classes (JSS 1, JSS 2, JSS 3 & SSS Tracks).

BEGIN;

-- 1. Wipe Academic & Assessment Test Data
TRUNCATE TABLE public.results CASCADE;
TRUNCATE TABLE public.attendance CASCADE;
TRUNCATE TABLE public.class_averages CASCADE;
TRUNCATE TABLE public.student_evaluations CASCADE;
TRUNCATE TABLE public.teacher_assignments CASCADE;
TRUNCATE TABLE public.student_subject_enrollments CASCADE;

-- 2. Wipe CBT / Online Assessment Test Data
TRUNCATE TABLE public.assessment_answers CASCADE;
TRUNCATE TABLE public.assessment_submissions CASCADE;
TRUNCATE TABLE public.assessment_questions CASCADE;
TRUNCATE TABLE public.assessments CASCADE;
TRUNCATE TABLE public.uploaded_scores CASCADE;

-- 3. Wipe Payments & Admissions Test Data
TRUNCATE TABLE public.payment_records CASCADE;
TRUNCATE TABLE public.payment_invoices CASCADE;
TRUNCATE TABLE public.admission_forms CASCADE;
TRUNCATE TABLE public.admission_payments CASCADE;

-- 4. Delete Non-Admin Users & Students
DELETE FROM public.students;
DELETE FROM public.users WHERE role IN ('teacher', 'student');

-- 5. Clean Up Classes: Remove all old classes and populate simplified JSS 1, JSS 2, JSS 3 & Senior tracks
TRUNCATE TABLE public.classes CASCADE;

INSERT INTO public.classes (school_id, name, session)
SELECT '00000000-0000-0000-0000-000000000001', c.name, '2025/2026'
FROM (VALUES
  ('JSS 1'),
  ('JSS 2'),
  ('JSS 3'),
  ('SSS 1 Science'), ('SSS 1 Arts'), ('SSS 1 Commercial'),
  ('SSS 2 Science'), ('SSS 2 Arts'), ('SSS 2 Commercial'),
  ('SSS 3 Science'), ('SSS 3 Arts'), ('SSS 3 Commercial')
) AS c(name);

COMMIT;

-- Verify exact clean class count (Should return 12)
SELECT id, name, session FROM public.classes ORDER BY name;
