-- ====================================================================
-- MIGRATION: 019_seed_canonical_classes_subjects.sql
-- Gracemark Academy — Seed Canonical 12 Classes & 27 Official Subjects
-- ====================================================================

-- 1. Seed Classes (12 Official Grade Levels)
INSERT INTO public.classes (name, level, display_order)
VALUES
  ('JSS 1', 'junior', 1),
  ('JSS 2', 'junior', 2),
  ('JSS 3', 'junior', 3),
  ('SSS 1 Science', 'senior', 4),
  ('SSS 1 Arts', 'senior', 5),
  ('SSS 1 Commercial', 'senior', 6),
  ('SSS 2 Science', 'senior', 7),
  ('SSS 2 Arts', 'senior', 8),
  ('SSS 2 Commercial', 'senior', 9),
  ('SSS 3 Science', 'senior', 10),
  ('SSS 3 Arts', 'senior', 11),
  ('SSS 3 Commercial', 'senior', 12)
ON CONFLICT (name) DO UPDATE 
SET 
  level = EXCLUDED.level,
  display_order = EXCLUDED.display_order;

-- 2. Seed Subjects (27 Official Subjects across Junior & Senior)
INSERT INTO public.subjects (name, code, level, periods_per_week)
VALUES
  -- Junior Only
  ('Business Studies', 'BST', 'junior', 2),
  ('Christian Religious Studies', 'CRS-J', 'junior', 3),
  ('Cultural and Creative Art', 'CCA', 'junior', 2),
  ('English Language', 'ENG-J', 'junior', 5),
  ('History', 'HIS', 'junior', 2),
  ('Intermediate Science', 'ISC', 'junior', 4),
  ('Physical and Health Education', 'PHE', 'junior', 2),
  ('Social and Citizenship Studies', 'SCS', 'junior', 3),

  -- Senior Only
  ('Account', 'ACC', 'senior', 4),
  ('Agric', 'AGR', 'senior', 3),
  ('Biology', 'BIO', 'senior', 4),
  ('Chemistry', 'CHE', 'senior', 4),
  ('Citizenship', 'CIT', 'senior', 3),
  ('Commerce', 'COM', 'senior', 4),
  ('CRS', 'CRS-S', 'senior', 4),
  ('Economics', 'ECN', 'senior', 3),
  ('English', 'ENG-S', 'senior', 5),
  ('Further Math', 'FMT', 'senior', 3),
  ('Government', 'GOV', 'senior', 4),
  ('Literature', 'LIT', 'senior', 4),
  ('Marketing', 'MKT', 'senior', 3),
  ('Physics', 'PHY', 'senior', 4),
  ('Technical Drawing', 'TD', 'senior', 3),

  -- Cross-level / Both
  ('Mathematics', 'MTH', 'both', 6),
  ('Digital Technology', 'DTC', 'both', 3),
  ('Trade', 'TRD', 'both', 2),
  ('Yoruba', 'YOR', 'both', 3)
ON CONFLICT (name) DO UPDATE 
SET 
  code = EXCLUDED.code,
  level = EXCLUDED.level,
  periods_per_week = EXCLUDED.periods_per_week;
