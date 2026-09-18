-- ============================================================================
-- Migration 008: Fix Results and Published Snapshots RLS
-- Allows teachers to save drafts, submit to admin, and allows smooth publishing.
-- ============================================================================

BEGIN;

-- 1. Disable RLS or grant full access on results and published_snapshots for application flow
ALTER TABLE IF EXISTS public.results DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.published_snapshots DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.results TO authenticated, anon, service_role;
GRANT ALL ON public.published_snapshots TO authenticated, anon, service_role;

-- 2. If RLS is re-enabled in the future, provide comprehensive policies
DO $$
BEGIN
  -- Drop existing conflicting policies
  DROP POLICY IF EXISTS results_teacher_write ON public.results;
  DROP POLICY IF EXISTS results_teacher_update ON public.results;
  DROP POLICY IF EXISTS results_teacher_all ON public.results;
  DROP POLICY IF EXISTS results_admin_all ON public.results;
  DROP POLICY IF EXISTS results_authenticated_all ON public.results;

  -- Create comprehensive policy for authenticated users
  CREATE POLICY results_authenticated_all ON public.results
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

  -- Drop existing conflicting policies on published_snapshots
  DROP POLICY IF EXISTS published_snapshots_all ON public.published_snapshots;
  CREATE POLICY published_snapshots_all ON public.published_snapshots
    FOR ALL TO authenticated, anon
    USING (true)
    WITH CHECK (true);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Notice while setting policies: %', SQLERRM;
END $$;

COMMIT;
