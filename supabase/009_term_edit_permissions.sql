-- ==============================================================================
-- Gracemark Migration 009: Term Grade Sheet Migration & Edit Permissions
-- Allows teachers to navigate through all terms of the session.
-- Only the active/current term can be edited by default unless admin permits edit.
-- ==============================================================================

BEGIN;

-- 1. Add allow_teacher_edit column to terms table if not present
ALTER TABLE public.terms ADD COLUMN IF NOT EXISTS allow_teacher_edit BOOLEAN DEFAULT false;

-- 2. Ensure term1, term2, term3 exist for sessions
INSERT INTO public.terms (session, term, school_days, status, allow_teacher_edit)
VALUES 
  ('2025/2026', 'term1', 65, 'open', true),
  ('2025/2026', 'term2', 65, 'closed', false),
  ('2025/2026', 'term3', 65, 'closed', false)
ON CONFLICT (session, term) DO UPDATE 
SET allow_teacher_edit = EXCLUDED.allow_teacher_edit
WHERE public.terms.allow_teacher_edit IS NULL;

-- 3. Grant access
GRANT ALL ON public.terms TO authenticated, anon, service_role;

COMMIT;
