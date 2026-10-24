-- Developer-managed settings that used to be hard-coded or env flags: scratch card price/views and
-- maintenance mode. Server-only (service role): RLS is on with no policies. Safe to re-run.
--
-- The app tolerates this table being missing or empty and falls back to its built-in defaults
-- (price 1000, 5 views, maintenance off), so it can be deployed before or after this runs.

CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- onlineEnabled is deliberately not seeded: until a developer sets it, online card sales follow the
-- SCRATCH_CARD_ONLINE_ENABLED environment flag.
INSERT INTO public.system_settings (key, value) VALUES
  ('scratch_card', '{"price": 1000, "viewsAllowed": 5}'::jsonb),
  ('maintenance', '{"enabled": false, "message": "", "backAt": null, "allowAdmins": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
