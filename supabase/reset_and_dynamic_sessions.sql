-- ==============================================================================
-- Gracemark Academy: Reset All Academic Sessions & Ensure Dynamic Sessions Schema
-- ==============================================================================
-- Run this script in the Supabase SQL Editor to wipe any test sessions and ensure
-- dynamic academic_sessions table structure and RLS policies are active.

BEGIN;

-- 1. Ensure academic_sessions table exists
CREATE TABLE IF NOT EXISTS public.academic_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  is_current boolean NOT NULL DEFAULT false,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.academic_sessions ENABLE ROW LEVEL SECURITY;

-- 3. Setup RLS Policies:
-- Allow authenticated & anon to read sessions so all portals (students, teachers, admin) can access active sessions.
DROP POLICY IF EXISTS academic_sessions_read_all ON public.academic_sessions;
CREATE POLICY academic_sessions_read_all ON public.academic_sessions
  FOR SELECT
  USING (true);

-- Allow admins or service role full management (insert, update, delete)
DROP POLICY IF EXISTS academic_sessions_admin_all ON public.academic_sessions;
CREATE POLICY academic_sessions_admin_all ON public.academic_sessions
  FOR ALL
  USING (
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR public.is_admin()
  )
  WITH CHECK (
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR public.is_admin()
  );

GRANT ALL ON TABLE public.academic_sessions TO authenticated, anon, service_role;

-- 4. Clean up all sessions created so far
TRUNCATE TABLE public.academic_sessions CASCADE;

-- 5. Reset app_settings current_session
UPDATE public.app_settings
SET current_session = ''
WHERE true;

-- 6. Clean up hardcoded session strings in classes if any
UPDATE public.classes
SET session = ''
WHERE session IN ('2024/2025', '2025/2026', '2026/2027', '2027/2028');

-- 7. Clean up hardcoded session strings in terms if any
UPDATE public.terms
SET session = ''
WHERE session IN ('2024/2025', '2025/2026', '2026/2027', '2027/2028');

COMMIT;

-- Verification
SELECT * FROM public.academic_sessions;
SELECT id, current_term, current_session FROM public.app_settings;
