-- Tighten who can call SECURITY DEFINER functions through the REST API (/rest/v1/rpc/*).
-- Flagged by the Supabase security advisor (lints 0028 / 0029 / 0011). Safe to re-run.
--
-- Rollback (re-grant what was removed):
--   GRANT EXECUTE ON FUNCTION <name>(<args>) TO anon, authenticated;   -- per function below

-- 1. Trigger functions. They fire from table triggers, which only need EXECUTE when the
--    trigger is created, so nobody needs to call them directly.
REVOKE EXECUTE ON FUNCTION public.sync_alumni_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_attendance_summary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_invoice_payment_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_student_class_from_enrollment() FROM PUBLIC, anon, authenticated;

-- 2. Role helpers used inside RLS policies. Every policy that calls them is scoped to the
--    `authenticated` role (checked against pg_policies), so signed-out users never need them.
REVOKE EXECUTE ON FUNCTION public."current_role"() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_student_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_student() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_teacher() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.teacher_assigned_to_subject(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.teacher_is_class_master(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.student_portal_locked() FROM PUBLIC, anon;

-- 3. Admission lookups return whole admissions / payment rows. The app never calls them
--    through the REST API (server routes use the service role), so close them to the public.
REVOKE EXECUTE ON FUNCTION public.lookup_admission_by_number(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lookup_admission_payment_by_ref(text) FROM PUBLIC, anon, authenticated;

-- 4. Pin search_path on the four trigger functions that left it mutable. They only touch
--    schema-qualified public.* objects.
ALTER FUNCTION public.sync_app_settings_session() SET search_path = public;
ALTER FUNCTION public.sync_sse_from_enrollment() SET search_path = public;
ALTER FUNCTION public.sync_results_from_enrollment() SET search_path = public;
ALTER FUNCTION public.sync_student_compat_fields() SET search_path = public;

-- Deliberately left open: public.verify_result_snapshot(text) (public report-card verification
-- by token). Not touched here: the pg_net extension in `public`, and Auth leaked-password
-- protection, which is a dashboard setting.
