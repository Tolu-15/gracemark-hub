-- ====================================================================
-- PHASE F: TERM / SESSION & PAYMENT NORMALIZATION MIGRATION
-- Canonical Terms: 'term1', 'term2', 'term3'
-- Canonical Payment Statuses: 'draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'
-- ====================================================================

-- 1. Normalize Term Representations Across All Tables
UPDATE public.results
SET term = CASE
  WHEN term ILIKE '%1%' OR term ILIKE '%first%' THEN 'term1'
  WHEN term ILIKE '%2%' OR term ILIKE '%second%' THEN 'term2'
  WHEN term ILIKE '%3%' OR term ILIKE '%third%' THEN 'term3'
  ELSE term
END;

UPDATE public.attendance
SET term = CASE
  WHEN term ILIKE '%1%' OR term ILIKE '%first%' THEN 'term1'
  WHEN term ILIKE '%2%' OR term ILIKE '%second%' THEN 'term2'
  WHEN term ILIKE '%3%' OR term ILIKE '%third%' THEN 'term3'
  ELSE term
END;

UPDATE public.attendance_records
SET term = CASE
  WHEN term ILIKE '%1%' OR term ILIKE '%first%' THEN 'term1'
  WHEN term ILIKE '%2%' OR term ILIKE '%second%' THEN 'term2'
  WHEN term ILIKE '%3%' OR term ILIKE '%third%' THEN 'term3'
  ELSE term
END;

UPDATE public.payment_invoices
SET term = CASE
  WHEN term ILIKE '%1%' OR term ILIKE '%first%' THEN 'term1'
  WHEN term ILIKE '%2%' OR term ILIKE '%second%' THEN 'term2'
  WHEN term ILIKE '%3%' OR term ILIKE '%third%' THEN 'term3'
  ELSE term
END;

UPDATE public.fee_structures
SET term = CASE
  WHEN term ILIKE '%1%' OR term ILIKE '%first%' THEN 'term1'
  WHEN term ILIKE '%2%' OR term ILIKE '%second%' THEN 'term2'
  WHEN term ILIKE '%3%' OR term ILIKE '%third%' THEN 'term3'
  ELSE term
END;

UPDATE public.published_snapshots
SET term = CASE
  WHEN term ILIKE '%1%' OR term ILIKE '%first%' THEN 'term1'
  WHEN term ILIKE '%2%' OR term ILIKE '%second%' THEN 'term2'
  WHEN term ILIKE '%3%' OR term ILIKE '%third%' THEN 'term3'
  ELSE term
END;

-- 2. Normalize Payment Invoice Statuses to Canonical Lowercase
UPDATE public.payment_invoices
SET status = CASE
  WHEN status IN ('FULLY PAID', 'paid') THEN 'paid'
  WHEN status IN ('PARTIALLY PAID', 'partially_paid') THEN 'partially_paid'
  WHEN status IN ('UNPAID', 'issued') THEN 'issued'
  WHEN status = 'overdue' THEN 'overdue'
  WHEN status = 'cancelled' THEN 'cancelled'
  ELSE 'draft'
END;

-- 3. Add CHECK constraints to prevent non-canonical writes
DO $$
BEGIN
  -- Results Term Check
  ALTER TABLE public.results DROP CONSTRAINT IF EXISTS results_term_check;
  ALTER TABLE public.results ADD CONSTRAINT results_term_check CHECK (term IN ('term1', 'term2', 'term3'));

  -- Attendance Term Check
  ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_term_check;
  ALTER TABLE public.attendance ADD CONSTRAINT attendance_term_check CHECK (term IN ('term1', 'term2', 'term3'));

  -- Attendance Records Term Check
  ALTER TABLE public.attendance_records DROP CONSTRAINT IF EXISTS attendance_records_term_check;
  ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_term_check CHECK (term IN ('term1', 'term2', 'term3'));

  -- Payment Invoices Status & Term Checks
  ALTER TABLE public.payment_invoices DROP CONSTRAINT IF EXISTS payment_invoices_term_check;
  ALTER TABLE public.payment_invoices ADD CONSTRAINT payment_invoices_term_check CHECK (term IN ('term1', 'term2', 'term3'));

  ALTER TABLE public.payment_invoices DROP CONSTRAINT IF EXISTS payment_invoices_status_check;
  ALTER TABLE public.payment_invoices ADD CONSTRAINT payment_invoices_status_check
    CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'));

  -- Payment Records Status Check
  ALTER TABLE public.payment_records DROP CONSTRAINT IF EXISTS payment_records_status_check;
  ALTER TABLE public.payment_records ADD CONSTRAINT payment_records_status_check
    CHECK (status IN ('pending', 'successful', 'success', 'failed', 'cancelled'));
END $$;
