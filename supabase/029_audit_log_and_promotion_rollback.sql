-- Audit trail + promotion rollback support. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs (entity_type, entity_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Writes happen only through server routes (service role). Admins may read; nobody can
-- edit or delete entries through the API, so the trail cannot be quietly rewritten.
DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_admin_read ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_admin());

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS rolled_back_by uuid;
