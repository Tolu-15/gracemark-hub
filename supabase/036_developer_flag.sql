-- ==============================================================================
-- MIGRATION: 036_developer_flag.sql
-- A flag on an admin's own users row that unlocks the Dev Tools page — kept
-- as a DB flag rather than a hardcoded email in source so it's manageable
-- without a deploy and never leaks an email address into the repo.
-- ==============================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_developer boolean NOT NULL DEFAULT false;
