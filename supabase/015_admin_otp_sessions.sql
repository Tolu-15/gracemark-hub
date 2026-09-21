-- ==============================================================================
-- Migration: 015_admin_otp_sessions.sql
-- Description:
--   Creates the admin_otp_sessions table for storing new-device OTP codes
--   used to verify admin logins from unrecognised browsers/devices.
--   OTPs have a 10-minute TTL and are single-use.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.admin_otp_sessions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id    uuid        NOT NULL,
  otp        text        NOT NULL,
  expires_at timestamptz NOT NULL,
  used       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by auth_id
CREATE INDEX IF NOT EXISTS admin_otp_sessions_auth_id_idx
  ON public.admin_otp_sessions (auth_id, used, created_at DESC);

-- Auto-clean expired / used OTPs older than 1 hour (optional, run via cron or pg_cron)
-- For now, the app handles this via TTL checks.

-- RLS: Only service_role can access this table (OTP logic runs server-side only)
ALTER TABLE public.admin_otp_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS otp_service_only ON public.admin_otp_sessions;
CREATE POLICY otp_service_only ON public.admin_otp_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Revoke all access from authenticated/anon — this table is server-side only
REVOKE ALL ON TABLE public.admin_otp_sessions FROM anon, authenticated;
GRANT ALL ON TABLE public.admin_otp_sessions TO service_role;
