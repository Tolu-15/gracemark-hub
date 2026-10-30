-- Public feedback is written only by the server route after Turnstile validation.
CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text,
  feedback_type text NOT NULL CHECK (feedback_type IN ('suggestion', 'technical_issue', 'general_feedback')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 3000),
  source_page text NOT NULL DEFAULT '/feedback',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_submissions_status_created_at_idx
  ON public.feedback_submissions (status, created_at DESC);

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feedback_service_only ON public.feedback_submissions;
CREATE POLICY feedback_service_only ON public.feedback_submissions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.feedback_submissions FROM anon, authenticated;
GRANT ALL ON TABLE public.feedback_submissions TO service_role;
