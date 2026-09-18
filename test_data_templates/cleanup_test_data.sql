-- =============================================================
-- Gracemark Academy — Test Data Cleanup Script
-- Run this script in Supabase SQL Editor when testing is finished.
-- It safely removes only the test records created from the templates.
-- =============================================================

BEGIN;

-- 1. Remove test assessment and terminal results
DELETE FROM public.results 
WHERE student_id IN (
    SELECT id FROM public.students 
    WHERE admission_no LIKE 'GM/2021/%'
       OR admission_no LIKE 'GM/2022/%'
       OR admission_no LIKE 'GM/2023/%'
       OR admission_no LIKE 'GM/2024/%'
       OR admission_no LIKE 'GM/2025/%'
);

-- 2. Remove test student evaluations & attendance
DELETE FROM public.student_evaluations 
WHERE student_id IN (
    SELECT id FROM public.students 
    WHERE admission_no LIKE 'GM/20%'
);

DELETE FROM public.attendance 
WHERE student_id IN (
    SELECT id FROM public.students 
    WHERE admission_no LIKE 'GM/20%'
);

-- 3. Remove test students
DELETE FROM public.students 
WHERE admission_no LIKE 'GM/20%';

-- 4. Remove test teacher assignments & profiles
DELETE FROM public.teacher_classes 
WHERE teacher_id IN (
    SELECT id FROM public.teachers 
    WHERE email LIKE '%@gracemark.sch.ng'
);

DELETE FROM public.teacher_subjects 
WHERE teacher_id IN (
    SELECT id FROM public.teachers 
    WHERE email LIKE '%@gracemark.sch.ng'
);

DELETE FROM public.teachers 
WHERE email LIKE '%@gracemark.sch.ng';

-- 5. Remove test users from public.users table
DELETE FROM public.users 
WHERE email LIKE '%@gracemark.sch.ng'
   OR email LIKE 'gm_20%@gracemark.internal';

COMMIT;

-- Verify cleanup
SELECT count(*) AS remaining_test_students FROM public.students WHERE admission_no LIKE 'GM/20%';
SELECT count(*) AS remaining_test_teachers FROM public.teachers WHERE email LIKE '%@gracemark.sch.ng';
