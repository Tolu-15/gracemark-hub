-- ====================================================================
-- MIGRATION: 017_add_subject_level.sql
-- Gracemark Academy — Add Target Level / Section to Subjects Table
-- ====================================================================

-- 1. Add level column to public.subjects if not exists
ALTER TABLE public.subjects 
ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'both' CHECK (level IN ('junior', 'senior', 'both'));

-- 2. Backfill Junior-only subjects
UPDATE public.subjects 
SET level = 'junior' 
WHERE name IN (
  'Business Studies',
  'Christian Religious Studies',
  'Cultural and Creative Art',
  'English Language',
  'History',
  'Intermediate Science',
  'Physical and Health Education',
  'Social and Citizenship Studies'
);

-- 3. Backfill Senior-only subjects
UPDATE public.subjects 
SET level = 'senior' 
WHERE name IN (
  'English',
  'Chemistry',
  'Physics',
  'Biology',
  'Government',
  'Literature',
  'Account',
  'Commerce',
  'CRS',
  'Economics',
  'Further Math',
  'Agric',
  'Technical Drawing',
  'Marketing',
  'Citizenship'
);

-- 4. Backfill Subjects taken across Both Junior & Senior
UPDATE public.subjects 
SET level = 'both' 
WHERE name IN (
  'Mathematics',
  'Trade',
  'Digital Technology',
  'Yoruba'
);
