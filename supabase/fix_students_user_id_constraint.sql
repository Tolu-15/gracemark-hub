-- ==========================================================
-- Fix students user_id constraint and default value
-- Allows students to be imported without prior auth accounts
-- ==========================================================

-- 1. Ensure user_id column has a default UUID generation
ALTER TABLE public.students ALTER COLUMN user_id SET DEFAULT gen_random_uuid();

-- 2. Drop NOT NULL constraint if desired so user_id can be optional or populated on demand
ALTER TABLE public.students ALTER COLUMN user_id DROP NOT NULL;
