BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_restricted_admin boolean NOT NULL DEFAULT false;

-- Account provisioning and privilege changes belong to trusted server operations.
REVOKE INSERT, DELETE, TRUNCATE ON public.users FROM anon, authenticated, PUBLIC;
CREATE OR REPLACE FUNCTION public.guard_profile_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('authenticated','anon') OR auth.role() IN ('authenticated','anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.role::text <> 'student' OR NEW.is_developer OR NEW.is_restricted_admin THEN
        RAISE EXCEPTION 'Staff profiles require authorized provisioning' USING ERRCODE = '42501';
      END IF;
    ELSIF ROW(NEW.id,NEW.auth_id,NEW.role,NEW.is_developer,NEW.is_restricted_admin)
       IS DISTINCT FROM ROW(OLD.id,OLD.auth_id,OLD.role,OLD.is_developer,OLD.is_restricted_admin) THEN
      RAISE EXCEPTION 'Account identity and privileges require authorized provisioning' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_profile_identity ON public.users;
CREATE TRIGGER guard_profile_identity BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_identity();

-- Existing browser-side edits also pass through RLS. Restrictive policies combine
-- with existing role/ownership policies, including permissive admin policies.
CREATE OR REPLACE FUNCTION public.can_write_as_portal_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id = auth.uid() AND is_restricted_admin)
$$;
REVOKE ALL ON FUNCTION public.can_write_as_portal_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_as_portal_user() TO authenticated;
DO $$
DECLARE tbl regclass;
BEGIN
  FOR tbl IN SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS restricted_admin_insert ON %s',tbl);
    EXECUTE format('CREATE POLICY restricted_admin_insert ON %s AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_write_as_portal_user())',tbl);
    EXECUTE format('DROP POLICY IF EXISTS restricted_admin_update ON %s',tbl);
    EXECUTE format('CREATE POLICY restricted_admin_update ON %s AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_write_as_portal_user()) WITH CHECK (public.can_write_as_portal_user())',tbl);
    EXECUTE format('DROP POLICY IF EXISTS restricted_admin_delete ON %s',tbl);
    EXECUTE format('CREATE POLICY restricted_admin_delete ON %s AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_write_as_portal_user())',tbl);
  END LOOP;
END;
$$;
COMMIT;
