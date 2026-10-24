-- Scratch cards for the Terminal Result (TR). See docs/SCRATCH_CARD_SPEC.md. Safe to re-run.
--
-- All access goes through server routes (service role), so RLS is enabled with no policies:
-- the browser cannot read or write these tables directly.

-- Online purchases: one row per Paystack checkout, so a payment can be recovered and a
-- duplicate notification can never create a second card.
CREATE TABLE IF NOT EXISTS public.scratch_card_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  term_code public.term_code_enum NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  -- duplicate: paid, but the student already held an open card for that term (needs a refund/credit)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'duplicate', 'failed')),
  card_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scratch_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial text NOT NULL UNIQUE,
  -- sha256 of the PIN; the PIN itself is never stored. NULL for online cards (they activate on payment).
  pin_hash text UNIQUE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  term_code public.term_code_enum NOT NULL,
  report_type text NOT NULL DEFAULT 'TR' CHECK (report_type = 'TR'),
  views_allowed integer NOT NULL DEFAULT 5 CHECK (views_allowed > 0),
  views_used integer NOT NULL DEFAULT 0 CHECK (views_used >= 0),
  source text NOT NULL CHECK (source IN ('online', 'offline', 'complimentary')),
  -- issued: PIN handed out, not yet entered | active: usable | exhausted: all views used | revoked
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'active', 'exhausted', 'revoked')),
  payment_reference text UNIQUE,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  issued_by_user_id uuid,
  issued_by_email text,
  revoked_reason text,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (views_used <= views_allowed)
);

-- A student can hold at most one open (issued/active) card per session + term, so a card can't be
-- sold twice for the same term. After exhaustion or revocation a new one may be bought.
CREATE UNIQUE INDEX IF NOT EXISTS uq_scratch_card_open
  ON public.scratch_cards (student_id, academic_session_id, term_code)
  WHERE status IN ('issued', 'active');
CREATE INDEX IF NOT EXISTS idx_scratch_cards_term ON public.scratch_cards (academic_session_id, term_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scratch_cards_student ON public.scratch_cards (student_id, created_at DESC);

-- One row for every view that was charged.
CREATE TABLE IF NOT EXISTS public.scratch_card_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.scratch_cards(id) ON DELETE CASCADE,
  viewer_auth_id uuid,
  views_used_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scratch_card_views_card ON public.scratch_card_views (card_id, created_at DESC);

-- Wrong PIN attempts, for rate limiting.
CREATE TABLE IF NOT EXISTS public.scratch_card_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  auth_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scratch_card_failures_student ON public.scratch_card_failures (student_id, created_at DESC);

ALTER TABLE public.scratch_card_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scratch_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scratch_card_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scratch_card_failures ENABLE ROW LEVEL SECURITY;
