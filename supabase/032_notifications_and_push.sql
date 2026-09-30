-- ==============================================================================
-- MIGRATION: 032_notifications_and_push.sql
-- In-app notification center + Web Push subscriptions, so teacher/admin actions
-- (score submissions, result approvals, announcements, timetable, publishing)
-- can alert the right people both inside the portal and as a browser push.
-- Writes happen only through server routes using the service-role client; RLS
-- below is defense-in-depth for direct client reads (e.g. the anon key).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  recipient_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role text,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications (recipient_user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_owner_select ON public.notifications;
CREATE POLICY notifications_owner_select ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS notifications_owner_update ON public.notifications;
CREATE POLICY notifications_owner_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()))
  WITH CHECK (recipient_user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- Web Push subscriptions (one row per browser/device the user enabled notifications on).
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_owner_all ON public.push_subscriptions;
CREATE POLICY push_subscriptions_owner_all ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()))
  WITH CHECK (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()));

NOTIFY pgrst, 'reload schema';
