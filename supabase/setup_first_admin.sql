-- Run AFTER schema.sql + rls.sql on a NEW Supabase project.
--
-- 1. Supabase Dashboard → Authentication → Users → Add user
--    (email + password you will use to log in)
-- 2. Copy that user's UUID from the Users table
-- 3. Replace PASTE-AUTH-USER-UUID below and run this script

insert into public.users (auth_id, email, display_name, role)
values (
  'PASTE-AUTH-USER-UUID',
  'admin@gracemark.edu.ng',
  'Admin',
  'admin'
)
on conflict (auth_id) do update
set role = 'admin', display_name = excluded.display_name, email = excluded.email;
