-- ==============================================================================
-- Gracemark Migration 007: Attendance, Cumulative Progress Reports,
-- Signatures & Publish Gating
-- ==============================================================================

BEGIN;

-- 1. Terms Table
CREATE TABLE IF NOT EXISTS public.terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session TEXT NOT NULL,           -- e.g. "2025/2026"
  term TEXT NOT NULL CHECK (term IN ('term1', 'term2', 'term3')),
  start_date DATE,
  end_date DATE,
  next_term_begins DATE,           -- stored directly on this term
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  school_days INT DEFAULT 65,      -- total school days in term
  holiday_sessions INT DEFAULT 0,  -- lost sessions due to holidays
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session, term)
);

-- Seed default current session term if not present
INSERT INTO public.terms (session, term, school_days, holiday_sessions, status)
VALUES ('2025/2026', 'term1', 65, 0, 'open')
ON CONFLICT (session, term) DO NOTHING;

-- 2. Upgrade / Expand Results Table
-- Add state machine columns and audit fields
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS submitted_by UUID;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS published_by UUID;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS returned_by UUID;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS return_reason TEXT;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS pr1_status TEXT DEFAULT 'draft';
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS pr2_status TEXT DEFAULT 'draft';
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS pr3_status TEXT DEFAULT 'draft';
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS tr_status TEXT DEFAULT 'draft';

-- Ensure status check includes 'submitted' and 'returned'
ALTER TABLE public.results DROP CONSTRAINT IF EXISTS results_status_check;
ALTER TABLE public.results ADD CONSTRAINT results_status_check 
  CHECK (status IN ('draft', 'submitted', 'approved', 'published', 'returned'));

-- 3. Upgrade Attendance Table for Morning & Afternoon Sessions
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS session TEXT DEFAULT '2025/2026';
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS recorded_by UUID;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS times_opened INT DEFAULT 130;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS times_present INT DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS times_absent INT DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS locked_by UUID;

-- 4. Daily Attendance Register (AM / PM per student)
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
  term TEXT NOT NULL CHECK (term IN ('term1', 'term2', 'term3')),
  session TEXT NOT NULL DEFAULT '2025/2026',
  date DATE NOT NULL,
  am_present BOOLEAN DEFAULT true,
  pm_present BOOLEAN DEFAULT true,
  recorded_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, term, session, date)
);
CREATE INDEX IF NOT EXISTS attendance_records_class_date_idx ON public.attendance_records(class_id, date);

-- 5. Signatures Table
CREATE TABLE IF NOT EXISTS public.signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL UNIQUE,          -- user auth id
  owner_role TEXT NOT NULL CHECK (owner_role IN ('principal', 'teacher', 'admin')),
  storage_path TEXT,                       -- path in private Supabase storage bucket
  signature_data TEXT,                     -- base64 / data URL backup
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);

-- Stamped Signatures (archived per result / snapshot)
CREATE TABLE IF NOT EXISTS public.result_signature_stamps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('PR1', 'PR2', 'PR3', 'TR')),
  term TEXT NOT NULL,
  session TEXT NOT NULL,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  signer_id UUID NOT NULL,
  signer_role TEXT NOT NULL CHECK (signer_role IN ('principal', 'teacher')),
  image_base64 TEXT NOT NULL,              -- frozen copy of signature image
  stamped_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Published Snapshots Table (Student Portal Source of Truth)
CREATE TABLE IF NOT EXISTS public.published_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL CHECK (term IN ('term1', 'term2', 'term3')),
  session TEXT NOT NULL DEFAULT '2025/2026',
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('PR1', 'PR2', 'PR3', 'TR')),
  snapshot_data JSONB NOT NULL,            -- complete denormalised report data
  published_at TIMESTAMPTZ DEFAULT now(),
  published_by UUID,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(term, session, student_id, report_type)
);
CREATE INDEX IF NOT EXISTS published_snapshots_student_lookup_idx 
  ON public.published_snapshots(student_id, term, session, report_type, is_active);

-- 7. Ensure Class Teachers Assignment
-- Add class_teacher_id to classes table if not present
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS class_teacher_id UUID;

-- 8. Disable RLS for custom tables for smooth app operations (or grant permissions)
ALTER TABLE public.terms DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_signature_stamps DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.published_snapshots DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.terms TO authenticated, anon;
GRANT ALL ON public.attendance TO authenticated, anon;
GRANT ALL ON public.attendance_records TO authenticated, anon;
GRANT ALL ON public.signatures TO authenticated, anon;
GRANT ALL ON public.result_signature_stamps TO authenticated, anon;
GRANT ALL ON public.published_snapshots TO authenticated, anon;

COMMIT;
