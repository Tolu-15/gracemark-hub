-- ==============================================================================
-- MIGRATION: 025_payment_security.sql
-- Payments and admissions are written ONLY by the server (service role) after
-- Paystack confirms the transaction. This removes the browser-side write paths
-- that could be used to fake a payment or an admission.
-- Written for the canonical schema (payment_invoices / payment_transactions /
-- admission_forms / admission_payments / admissions). Safe to run repeatedly.
-- ==============================================================================

-- 1. Admission tables: nothing is open to anonymous visitors any more. The public
--    admission form talks to /api/admissions/*, which uses the service role.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('admissions', 'admission_payments')
      AND (roles && ARRAY['anon', 'public']::name[])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.admissions FROM anon;
REVOKE ALL ON TABLE public.admission_payments FROM anon;

-- 2. Invoices and transactions can be READ by the owning student and by admins, but
--    are never written from a browser. Admin manual payments go through
--    /api/admin/finance/manual-payment; the DB trigger keeps invoice totals in step.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_invoices FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_transactions FROM anon, authenticated;

-- 3. Legacy payment RPC (if it exists in this database) is server-only.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_student_payment') THEN
    REVOKE EXECUTE ON FUNCTION public.record_student_payment(uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.record_student_payment(uuid, uuid, text, numeric, text) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
