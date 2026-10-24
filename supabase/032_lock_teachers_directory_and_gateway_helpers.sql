-- teachers_directory is an auto-updatable view over users; default grants let anon
-- update/delete teacher rows (e.g. set role = 'admin') bypassing RLS.
REVOKE ALL ON public.teachers_directory FROM anon;
REVOKE ALL ON public.teachers_directory FROM authenticated;
GRANT SELECT ON public.teachers_directory TO authenticated;

REVOKE ALL ON FUNCTION public.encrypt_gateway_secret(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decrypt_gateway_secret(bytea, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encrypt_gateway_secret(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_gateway_secret(bytea, text) TO service_role;

ALTER FUNCTION public.encrypt_gateway_secret(text, text) SET search_path = public, extensions;
ALTER FUNCTION public.decrypt_gateway_secret(bytea, text) SET search_path = public, extensions;
