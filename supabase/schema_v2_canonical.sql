/* -- ============================================================================
-- GRACEMARK ACADEMY HUB: CANONICAL PRODUCTION DATABASE SCHEMA (V2)
-- Architecture: Single Source of Truth, 34 Normalized Canonical Tables
-- Generated in accordance with Mandatory Cleanup Directive & Official PRD
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. POSTGRESQL ENUMS (Defined once, used everywhere)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.user_role_enum AS ENUM ('admin', 'teacher', 'student');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.user_status_enum AS ENUM ('active', 'suspended', 'inactive');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.session_status_enum AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.term_code_enum AS ENUM ('term1', 'term2', 'term3');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.term_status_enum AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.curriculum_level_enum AS ENUM ('junior', 'senior', 'both');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.gender_enum AS ENUM ('male', 'female');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.portal_access_status_enum AS ENUM ('active', 'locked');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.portal_access_action_enum AS ENUM ('locked', 'unlocked');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.assignment_status_enum AS ENUM ('active', 'ended');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.enrollment_status_enum AS ENUM ('active', 'promoted', 'repeated', 'graduated', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.subject_enrollment_status_enum AS ENUM ('enrolled', 'dropped', 'exempted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.result_status_enum AS ENUM ('draft', 'submitted', 'approved', 'published', 'returned');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.checkpoint_status_enum AS ENUM ('draft', 'published');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.report_type_enum AS ENUM ('PR1', 'PR2', 'PR3', 'TR');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.signer_role_enum AS ENUM ('principal', 'teacher');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.cbt_question_type_enum AS ENUM ('multiple_choice', 'true_false', 'fill_in_the_blank', 'short_answer', 'essay');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.cbt_submission_status_enum AS ENUM ('started', 'submitted', 'graded');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status_enum AS ENUM ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_gateway_enum AS ENUM ('paystack', 'flutterwave', 'manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.transaction_status_enum AS ENUM ('pending', 'success', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.form_status_enum AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.boarding_type_enum AS ENUM ('full', 'weekday');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.admission_status_enum AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'enrolled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ----------------------------------------------------------------------------
-- DOMAIN 1: IDENTITY & PLATFORM SETTINGS (Tables 1 - 5)
-- ----------------------------------------------------------------------------

-- Table 1: users (Single source of truth for platform identity)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id text UNIQUE,
  display_name text,
  email text,
  phone text,
  role public.user_role_enum NOT NULL,
  status public.user_status_enum NOT NULL DEFAULT 'active',
  must_change_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table 2: app_settings (Singleton platform parameters)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_session_id uuid, -- FK resolved after academic_sessions is created
  current_term public.term_code_enum NOT NULL DEFAULT 'term1',
  school_default_days integer NOT NULL DEFAULT 120 CHECK (school_default_days > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table 3: admin_otp_sessions (Hashed OTP 2FA tokens)
CREATE TABLE IF NOT EXISTS public.admin_otp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  otp_hash text NOT NULL, -- Salted & hashed via pgcrypto crypt()
  action_type text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table 4: portal_access_settings (Singleton fee lockout policy)
CREATE TABLE IF NOT EXISTS public.portal_access_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  restrict_outstanding_fees boolean NOT NULL DEFAULT false,
  lock_after_due_date boolean NOT NULL DEFAULT false,
  grace_period_days integer NOT NULL DEFAULT 7 CHECK (grace_period_days >= 0),
  auto_unlock_on_full_payment boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table 5: student_portal_access_logs (Audit log for student portal locks)
CREATE TABLE IF NOT EXISTS public.student_portal_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL, -- FK resolved after students is created
  action public.portal_access_action_enum NOT NULL,
  reason text,
  performed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- DOMAIN 2: ACADEMIC CALENDAR & DELEGATIONS (Tables 6 - 11)
-- ----------------------------------------------------------------------------

-- Table 6: academic_sessions (Canonical academic year)
CREATE TABLE IF NOT EXISTS public.academic_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (name ~ '^\d{4}/\d{4}$'), -- Enforces canonical YYYY/YYYY format
  status public.session_status_enum NOT NULL DEFAULT 'active',
  is_current boolean NOT NULL DEFAULT false,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_current_session 
  ON public.academic_sessions(is_current) 
  WHERE (is_current = true);

-- Add deferred FK to app_settings
ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_current_session_id_fkey,
  ADD CONSTRAINT app_settings_current_session_id_fkey 
  FOREIGN KEY (current_session_id) REFERENCES public.academic_sessions(id) ON DELETE SET NULL;

-- Table 7: academic_terms (Terms per session)
CREATE TABLE IF NOT EXISTS public.academic_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  term_code public.term_code_enum NOT NULL,
  status public.term_status_enum NOT NULL DEFAULT 'open',
  school_days integer NOT NULL DEFAULT 120 CHECK (school_days > 0),
  allow_teacher_edit boolean NOT NULL DEFAULT false,
  start_date date,
  end_date date,
  next_term_begins date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_academic_session_term UNIQUE (academic_session_id, term_code)
);

-- Table 8: classes (Official grade levels)
CREATE TABLE IF NOT EXISTS public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  level public.curriculum_level_enum NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table 9: sections (Class arms)
CREATE TABLE IF NOT EXISTS public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_class_section_name UNIQUE (class_id, name)
);

-- Table 10: class_teacher_assignments (Form master delegations)
CREATE TABLE IF NOT EXISTS public.class_teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  teacher_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status public.assignment_status_enum NOT NULL DEFAULT 'active',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  notes text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_active_class_teacher 
  ON public.class_teacher_assignments(
    academic_session_id, 
    class_id, 
    COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) 
  WHERE (status = 'active');

CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_teacher 
  ON public.class_teacher_assignments(teacher_user_id);

-- Table 11: subject_teacher_assignments (Subject specialist delegations)
CREATE TABLE IF NOT EXISTS public.subject_teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  subject_id uuid NOT NULL, -- FK resolved after subjects is created
  teacher_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status public.assignment_status_enum NOT NULL DEFAULT 'active',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  notes text
);

-- ----------------------------------------------------------------------------
-- DOMAIN 3: STUDENTS & SINGLE-POINT ENROLLMENT (Tables 12 - 15)
-- ----------------------------------------------------------------------------

-- Table 12: students (Biographical student profile)
CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  admission_no text NOT NULL UNIQUE,
  full_name text NOT NULL,
  gender public.gender_enum NOT NULL,
  date_of_birth date,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  passport_url text,
  is_alumni boolean NOT NULL DEFAULT false, -- Explicit trigger-maintained cache from alumni_students
  portal_access_status public.portal_access_status_enum NOT NULL DEFAULT 'active',
  portal_lock_reason text,
  current_class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL, -- Explicit trigger-maintained cache
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add deferred FK to student_portal_access_logs
ALTER TABLE public.student_portal_access_logs
  DROP CONSTRAINT IF EXISTS student_portal_access_logs_student_id_fkey,
  ADD CONSTRAINT student_portal_access_logs_student_id_fkey 
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

-- Table 13: student_enrollments (Canonical single source of truth for session placement)
CREATE TABLE IF NOT EXISTS public.student_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  status public.enrollment_status_enum NOT NULL DEFAULT 'active',
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_session_enrollment UNIQUE (student_id, academic_session_id)
);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_student_id ON public.student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_class_id ON public.student_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_session_id ON public.student_enrollments(academic_session_id);

-- Table 14: subjects (Academic curriculum catalogue)
CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  level public.curriculum_level_enum NOT NULL DEFAULT 'both',
  periods_per_week integer NOT NULL DEFAULT 4 CHECK (periods_per_week > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add deferred FK to subject_teacher_assignments
ALTER TABLE public.subject_teacher_assignments
  DROP CONSTRAINT IF EXISTS subject_teacher_assignments_subject_id_fkey,
  ADD CONSTRAINT subject_teacher_assignments_subject_id_fkey 
  FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_active_subject_teacher 
  ON public.subject_teacher_assignments(
    academic_session_id, 
    class_id, 
    subject_id, 
    COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) 
  WHERE (status = 'active');

CREATE INDEX IF NOT EXISTS idx_subject_teacher_assignments_teacher 
  ON public.subject_teacher_assignments(teacher_user_id);

-- Table 15: student_subject_enrollments (Explicit student-subject registration)
CREATE TABLE IF NOT EXISTS public.student_subject_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.student_enrollments(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  status public.subject_enrollment_status_enum NOT NULL DEFAULT 'enrolled',
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  dropped_at timestamptz,
  CONSTRAINT uq_enrollment_subject UNIQUE (enrollment_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_student_subject_enrollments_enrollment_id ON public.student_subject_enrollments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_student_subject_enrollments_subject_id ON public.student_subject_enrollments(subject_id);

-- ----------------------------------------------------------------------------
-- DOMAIN 4: GRADEBOOK & CONTINUOUS ASSESSMENT (Tables 16 - 17)
-- ----------------------------------------------------------------------------

-- Table 16: results (Component scores & incremental checkpoint publications)
-- Exactly aligned with src/lib/gradingEngine.ts GRADING_CONFIG:
-- CW /10 + HW /5 + Tests /10 + Project /5 + Exam /70 = Grand Total /100.00
CREATE TABLE IF NOT EXISTS public.results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.student_enrollments(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  term public.term_code_enum NOT NULL,
  cw numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (cw >= 0 AND cw <= 10.00),         -- Classwork scaled /10
  hw numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (hw >= 0 AND hw <= 5.00),          -- Homework scaled /5
  test numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (test >= 0 AND test <= 10.00),    -- Tests scaled /10
  project numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (project >= 0 AND project <= 5.00), -- Project scaled /5
  exam numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (exam >= 0 AND exam <= 70.00),   -- Terminal Exam /70
  total numeric(5,2) GENERATED ALWAYS AS (cw + hw + test + project + exam) STORED, -- Grand Total /100
  score_breakdown jsonb DEFAULT '{"cw":[],"hw":[],"tests":[],"project":0,"exam":0}'::jsonb,
  grade text NOT NULL DEFAULT 'F9',
  status public.result_status_enum NOT NULL DEFAULT 'draft',
  pr1_status public.checkpoint_status_enum NOT NULL DEFAULT 'draft',
  pr2_status public.checkpoint_status_enum NOT NULL DEFAULT 'draft',
  pr3_status public.checkpoint_status_enum NOT NULL DEFAULT 'draft',
  tr_status public.checkpoint_status_enum NOT NULL DEFAULT 'draft',
  teacher_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  return_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_enrollment_subject_term UNIQUE (enrollment_id, subject_id, term),
  CONSTRAINT chk_total_score CHECK (total >= 0 AND total <= 100.00)
);

CREATE INDEX IF NOT EXISTS idx_results_enrollment_id ON public.results(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_results_subject_id ON public.results(subject_id);

-- Table 17: result_snapshots (Cryptographically verifiable frozen report payloads)
CREATE TABLE IF NOT EXISTS public.result_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.student_enrollments(id) ON DELETE CASCADE,
  term public.term_code_enum NOT NULL,
  report_type public.report_type_enum NOT NULL,
  snapshot_data jsonb NOT NULL,
  verification_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  published_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_enrollment_term_report UNIQUE (enrollment_id, term, report_type)
);

-- ----------------------------------------------------------------------------
-- DOMAIN 5: ATTENDANCE TRACKING (Tables 18 - 19)
-- ----------------------------------------------------------------------------

-- Table 18: attendance_records (Daily roll call records)
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.student_enrollments(id) ON DELETE CASCADE,
  term public.term_code_enum NOT NULL,
  date date NOT NULL,
  am_present boolean NOT NULL DEFAULT true,
  pm_present boolean NOT NULL DEFAULT true,
  recorded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_enrollment_attendance_date UNIQUE (enrollment_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_enrollment_id ON public.attendance_records(enrollment_id);

-- Table 19: attendance_summaries (Explicit trigger-maintained summary cache)
CREATE TABLE IF NOT EXISTS public.attendance_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.student_enrollments(id) ON DELETE CASCADE,
  term public.term_code_enum NOT NULL,
  times_opened integer NOT NULL DEFAULT 120 CHECK (times_opened >= 0),
  times_present integer NOT NULL DEFAULT 0 CHECK (times_present >= 0),
  times_absent integer NOT NULL DEFAULT 0 CHECK (times_absent >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_enrollment_term_attendance UNIQUE (enrollment_id, term)
);

-- ----------------------------------------------------------------------------
-- DOMAIN 6: HOLISTIC EVALUATIONS & SIGNATURES (Tables 20 - 21)
-- ----------------------------------------------------------------------------

-- Table 20: student_evaluations (Affective & psychomotor ratings, remarks)
CREATE TABLE IF NOT EXISTS public.student_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.student_enrollments(id) ON DELETE CASCADE,
  term public.term_code_enum NOT NULL,
  punctuality integer CHECK (punctuality BETWEEN 1 AND 5),
  neatness integer CHECK (neatness BETWEEN 1 AND 5),
  honesty integer CHECK (honesty BETWEEN 1 AND 5),
  cooperation integer CHECK (cooperation BETWEEN 1 AND 5),
  leadership integer CHECK (leadership BETWEEN 1 AND 5),
  sports integer CHECK (sports BETWEEN 1 AND 5),
  crafts integer CHECK (crafts BETWEEN 1 AND 5),
  handwriting integer CHECK (handwriting BETWEEN 1 AND 5),
  teacher_remark text,
  principal_remark text,
  evaluated_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_enrollment_term_evaluation UNIQUE (enrollment_id, term)
);

-- Table 21: signatures (Official digital signatures for Principal and Form Masters)
CREATE TABLE IF NOT EXISTS public.signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  signer_role public.signer_role_enum NOT NULL,
  signature_image_url text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- DOMAIN 7: COMPUTER-BASED TESTING (CBT) (Tables 22 - 24)
-- ----------------------------------------------------------------------------

-- Table 22: cbt_exams (Online examinations and quizzes)
CREATE TABLE IF NOT EXISTS public.cbt_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  term public.term_code_enum NOT NULL,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  pass_mark integer NOT NULL DEFAULT 50 CHECK (pass_mark BETWEEN 0 AND 100),
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table 23: cbt_questions (Auto-graded and manual question formats)
CREATE TABLE IF NOT EXISTS public.cbt_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.cbt_exams(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  question_type public.cbt_question_type_enum NOT NULL,
  options jsonb DEFAULT '[]'::jsonb,
  correct_answer text,
  points numeric(5,2) NOT NULL DEFAULT 1.00 CHECK (points > 0),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table 24: cbt_submissions (Student attempts, auto + manual grading)
CREATE TABLE IF NOT EXISTS public.cbt_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.cbt_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.student_enrollments(id) ON DELETE CASCADE,
  auto_score numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (auto_score >= 0),
  manual_score numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (manual_score >= 0),
  total_score numeric(5,2) GENERATED ALWAYS AS (auto_score + manual_score) STORED,
  passed boolean NOT NULL DEFAULT false,
  status public.cbt_submission_status_enum NOT NULL DEFAULT 'started',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  teacher_feedback text,
  graded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  graded_at timestamptz,
  CONSTRAINT uq_cbt_exam_student UNIQUE (exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_cbt_submissions_student_id ON public.cbt_submissions(student_id);

-- ----------------------------------------------------------------------------
-- DOMAIN 8: FINANCE & PAYSTACK GATEWAY (Tables 25 - 28)
-- ----------------------------------------------------------------------------

-- Table 25: fee_structures (Approved fee schedules per class/term)
CREATE TABLE IF NOT EXISTS public.fee_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  term public.term_code_enum NOT NULL,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  title text NOT NULL,
  tuition_amount numeric(10,2) NOT NULL DEFAULT 0.00 CHECK (tuition_amount >= 0),
  development_levy numeric(10,2) NOT NULL DEFAULT 0.00 CHECK (development_levy >= 0),
  exam_levy numeric(10,2) NOT NULL DEFAULT 0.00 CHECK (exam_levy >= 0),
  total_amount numeric(10,2) GENERATED ALWAYS AS (tuition_amount + development_levy + exam_levy) STORED,
  due_date date,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fee_structure_class_term UNIQUE (academic_session_id, term, class_id)
);

-- Table 26: payment_gateway_configs (Encrypted gateway API credentials)
-- In production, secret_key and webhook_secret are stored encrypted using pgcrypto pgp_sym_encrypt()
-- and only accessed by the service role or administrative functions.
CREATE TABLE IF NOT EXISTS public.payment_gateway_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway public.payment_gateway_enum NOT NULL UNIQUE,
  public_key text NOT NULL,
  secret_key_cipher bytea NOT NULL,   -- Ciphertext encrypted via pgp_sym_encrypt()
  webhook_secret_cipher bytea,        -- Ciphertext encrypted via pgp_sym_encrypt()
  is_live boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table 27: payment_invoices (Student term invoices & running balances)
CREATE TABLE IF NOT EXISTS public.payment_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  enrollment_id uuid NOT NULL REFERENCES public.student_enrollments(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  fee_structure_id uuid NOT NULL REFERENCES public.fee_structures(id) ON DELETE RESTRICT,
  total_amount numeric(10,2) NOT NULL CHECK (total_amount >= 0),
  amount_paid numeric(10,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0),
  balance_due numeric(10,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  status public.payment_status_enum NOT NULL DEFAULT 'issued',
  due_date date,
  issued_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_enrollment_fee_structure UNIQUE (enrollment_id, fee_structure_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_invoices_student_id ON public.payment_invoices(student_id);

-- Table 28: payment_transactions (Verified transaction receipts)
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.payment_invoices(id) ON DELETE RESTRICT,
  payment_reference text NOT NULL UNIQUE,
  receipt_number text NOT NULL UNIQUE,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  gateway public.payment_gateway_enum NOT NULL,
  gateway_response jsonb,
  status public.transaction_status_enum NOT NULL DEFAULT 'pending',
  paid_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_invoice_id ON public.payment_transactions(invoice_id);

-- ----------------------------------------------------------------------------
-- DOMAIN 9: ADMISSIONS & AUDITING (Tables 29 - 32)
-- ----------------------------------------------------------------------------

-- Table 29: admission_forms (Admission packages and session pricing)
CREATE TABLE IF NOT EXISTS public.admission_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  amount numeric(10,2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0),
  status public.form_status_enum NOT NULL DEFAULT 'active',
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table 30: admission_payments (Full payment ledger for sold form packages)
CREATE TABLE IF NOT EXISTS public.admission_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_form_id uuid NOT NULL REFERENCES public.admission_forms(id) ON DELETE RESTRICT,
  applicant_email text NOT NULL,
  applicant_phone text,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  payment_reference text NOT NULL UNIQUE,
  receipt_number text NOT NULL UNIQUE,
  gateway public.payment_gateway_enum NOT NULL DEFAULT 'paystack',
  gateway_response jsonb,
  status public.transaction_status_enum NOT NULL DEFAULT 'pending',
  paid_at timestamptz NOT NULL DEFAULT now()
);

-- Table 31: admissions (Prospective applicant biodata & conversion)
CREATE TABLE IF NOT EXISTS public.admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_number text NOT NULL UNIQUE,
  admission_form_id uuid NOT NULL REFERENCES public.admission_forms(id) ON DELETE RESTRICT,
  admission_payment_id uuid REFERENCES public.admission_payments(id) ON DELETE SET NULL,
  surname text NOT NULL,
  first_names text NOT NULL,
  gender public.gender_enum NOT NULL,
  date_of_birth date,
  nationality text NOT NULL DEFAULT 'Nigerian',
  state_of_origin text,
  religion text,
  home_address text,
  city text,
  state text,
  passport_url text,
  previous_school_name text,
  previous_school_address text,
  previous_class text,
  is_boarding boolean NOT NULL DEFAULT false,
  boarding_type public.boarding_type_enum,
  medical_conditions text,
  allergies text,
  dietary_requirements text,
  desired_class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  parent_name text NOT NULL,
  parent_phone text NOT NULL,
  parent_email text,
  parent_occupation text,
  referral_source text,
  special_skills text,
  status public.admission_status_enum NOT NULL DEFAULT 'submitted',
  created_student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table 32: admissions_audit (Audit log of admission application transitions)
CREATE TABLE IF NOT EXISTS public.admissions_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  action text NOT NULL,
  performed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- DOMAIN 10: PROMOTIONS & ALUMNI (Tables 33 - 34)
-- ----------------------------------------------------------------------------

-- Table 33: promotions (End-of-year batch promotion logs)
CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  to_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  promoted_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  promoted_at timestamptz NOT NULL DEFAULT now()
);

-- Table 34: alumni_students (Historical directory of graduated SSS 3 students)
CREATE TABLE IF NOT EXISTS public.alumni_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL UNIQUE REFERENCES public.students(id) ON DELETE CASCADE,
  graduated_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE RESTRICT,
  promotion_id uuid REFERENCES public.promotions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- SEED DATA: Singleton Settings Initializers (Requirement 3)
-- ----------------------------------------------------------------------------
INSERT INTO public.app_settings (id, current_term, school_default_days, updated_at)
VALUES (1, 'term1', 120, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.portal_access_settings (id, restrict_outstanding_fees, lock_after_due_date, grace_period_days, auto_unlock_on_full_payment, updated_at)
VALUES (1, false, false, 7, true, now())
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- ENCRYPTION & DECRYPTION HELPERS (Requirement 2 & Fix 4)
-- ----------------------------------------------------------------------------
-- pgp_sym_encrypt uses a random salt/IV every invocation: MUST be VOLATILE!
CREATE OR REPLACE FUNCTION public.encrypt_gateway_secret(p_secret text, p_passphrase text)
RETURNS bytea
LANGUAGE sql
VOLATILE
SECURITY DEFINER
AS $$
  SELECT pgp_sym_encrypt(p_secret, p_passphrase);
$$;

-- pgp_sym_decrypt given a specific ciphertext and key is STABLE
CREATE OR REPLACE FUNCTION public.decrypt_gateway_secret(p_cipher bytea, p_passphrase text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT pgp_sym_decrypt(p_cipher, p_passphrase);
$$;

-- Restrict cryptographic functions strictly to service_role
REVOKE ALL ON FUNCTION public.encrypt_gateway_secret(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decrypt_gateway_secret(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_gateway_secret(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_gateway_secret(bytea, text) TO service_role;

-- ----------------------------------------------------------------------------
-- TRIGGERS & TRIGGER FUNCTIONS (Rule 7: Documented Derived Caches)
-- ----------------------------------------------------------------------------

-- Trigger 1: Maintain students.current_class_id cache
-- Behavior:
--  - If enrollment is 'active', updates students.current_class_id to new class.
--  - If enrollment transitions to 'graduated' or 'withdrawn', freezes at the last class attended.
CREATE OR REPLACE FUNCTION public.sync_student_class_from_enrollment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.status = 'active') THEN
    UPDATE public.students
    SET current_class_id = NEW.class_id,
        updated_at = now()
    WHERE id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_student_class_from_enrollment ON public.student_enrollments;
CREATE TRIGGER trg_sync_student_class_from_enrollment
AFTER INSERT OR UPDATE OF class_id, status ON public.student_enrollments
FOR EACH ROW EXECUTE FUNCTION public.sync_student_class_from_enrollment();

-- Trigger 2: Maintain students.is_alumni cache from alumni_students
CREATE OR REPLACE FUNCTION public.sync_alumni_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.students SET is_alumni = true, updated_at = now() WHERE id = NEW.student_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.students SET is_alumni = false, updated_at = now() WHERE id = OLD.student_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_alumni_status ON public.alumni_students;
CREATE TRIGGER trg_sync_alumni_status
AFTER INSERT OR DELETE ON public.alumni_students
FOR EACH ROW EXECUTE FUNCTION public.sync_alumni_status();

-- Trigger 3: Recalculate attendance_summaries cache from daily attendance_records
-- Requirement 5: One half missing means 0! Both AM and PM must be true to count as present.
CREATE OR REPLACE FUNCTION public.sync_attendance_summary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment_id uuid;
  v_term public.term_code_enum;
  v_present integer;
  v_opened integer;
BEGIN
  v_enrollment_id := COALESCE(NEW.enrollment_id, OLD.enrollment_id);
  v_term := COALESCE(NEW.term, OLD.term);

  -- Count present days strictly where BOTH AM and PM attendance were true (one half missing means 0)
  SELECT count(*) INTO v_present
  FROM public.attendance_records
  WHERE enrollment_id = v_enrollment_id 
    AND term = v_term 
    AND (am_present = true AND pm_present = true);

  -- Fetch default term school days
  SELECT COALESCE(t.school_days, 120) INTO v_opened
  FROM public.student_enrollments se
  LEFT JOIN public.academic_terms t 
    ON t.academic_session_id = se.academic_session_id AND t.term_code = v_term
  WHERE se.id = v_enrollment_id;

  IF (v_opened IS NULL OR v_opened = 0) THEN
    v_opened := 120;
  END IF;

  INSERT INTO public.attendance_summaries (enrollment_id, term, times_opened, times_present, times_absent, updated_at)
  VALUES (v_enrollment_id, v_term, v_opened, v_present, GREATEST(0, v_opened - v_present), now())
  ON CONFLICT (enrollment_id, term) DO UPDATE
  SET times_opened = EXCLUDED.times_opened,
      times_present = EXCLUDED.times_present,
      times_absent = EXCLUDED.times_absent,
      updated_at = now();

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_attendance_summary ON public.attendance_records;
CREATE TRIGGER trg_sync_attendance_summary
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.sync_attendance_summary();

-- Trigger 4: Recalculate payment_invoices amount_paid and status from payment_transactions
-- Requirement 5: Guard against overwriting cancelled invoices!
CREATE OR REPLACE FUNCTION public.sync_invoice_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
  v_current_status public.payment_status_enum;
  v_total_paid numeric(10,2);
  v_total_amount numeric(10,2);
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT status, total_amount INTO v_current_status, v_total_amount
  FROM public.payment_invoices
  WHERE id = v_invoice_id;

  -- Guard: If invoice is already cancelled, never overwrite status or amount
  IF (v_current_status = 'cancelled') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(sum(amount), 0.00) INTO v_total_paid
  FROM public.payment_transactions
  WHERE invoice_id = v_invoice_id AND status = 'success';

  UPDATE public.payment_invoices
  SET amount_paid = v_total_paid,
      status = CASE
        WHEN v_total_paid >= v_total_amount AND v_total_amount > 0 THEN 'paid'::public.payment_status_enum
        WHEN v_total_paid > 0 THEN 'partially_paid'::public.payment_status_enum
        ELSE 'issued'::public.payment_status_enum
      END,
      updated_at = now()
  WHERE id = v_invoice_id AND status != 'cancelled';

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice_payment_status ON public.payment_transactions;
CREATE TRIGGER trg_sync_invoice_payment_status
AFTER INSERT OR UPDATE OF status, amount OR DELETE ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_payment_status();

-- ----------------------------------------------------------------------------
-- SECURITY: RLS HELPER FUNCTIONS & POLICIES (Requirement 1)
-- ----------------------------------------------------------------------------

-- Helper: Current authenticated user ID in public.users
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1;
$$;

-- Helper: Current role of authenticated user
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS public.user_role_enum
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_role() = 'admin'::public.user_role_enum;
$$;

CREATE OR REPLACE FUNCTION public.is_teacher()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_role() = 'teacher'::public.user_role_enum;
$$;

CREATE OR REPLACE FUNCTION public.is_student()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_role() = 'student'::public.user_role_enum;
$$;

-- Helper: Current student row ID
CREATE OR REPLACE FUNCTION public.current_student_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id FROM public.students s WHERE s.user_id = public.current_user_id() LIMIT 1;
$$;

-- Helper: Check if current teacher teaches class+subject
CREATE OR REPLACE FUNCTION public.teacher_assigned_to_subject(p_class_id uuid, p_subject_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subject_teacher_assignments sta
    WHERE sta.teacher_user_id = public.current_user_id()
      AND sta.class_id = p_class_id
      AND sta.subject_id = p_subject_id
      AND sta.status = 'active'
  );
$$;

-- Helper: Check if current teacher is form master of class
CREATE OR REPLACE FUNCTION public.teacher_is_class_master(p_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_teacher_assignments cta
    WHERE cta.teacher_user_id = public.current_user_id()
      AND cta.class_id = p_class_id
      AND cta.status = 'active'
  );
$$;

-- Enable RLS across all 34 tables
DO $$ 
DECLARE 
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' ENABLE ROW LEVEL SECURITY;';
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- RLS POLICIES PER TABLE
-- ----------------------------------------------------------------------------

-- Table 1: users
CREATE POLICY users_admin_all ON public.users FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY users_view_own ON public.users FOR SELECT TO authenticated USING (auth_id = auth.uid());
-- NOTE: Blanket users_view_teachers was REMOVED to protect teachers' personal phone numbers and emails.
-- Students and parents query public.teachers_directory view instead.

-- Table 2: app_settings
CREATE POLICY app_settings_admin_all ON public.app_settings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY app_settings_read_auth ON public.app_settings FOR SELECT TO authenticated USING (true);

-- Table 3: admin_otp_sessions
CREATE POLICY admin_otp_admin_all ON public.admin_otp_sessions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Table 4: portal_access_settings
CREATE POLICY portal_access_admin_all ON public.portal_access_settings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY portal_access_read_auth ON public.portal_access_settings FOR SELECT TO authenticated USING (true);

-- Table 5: student_portal_access_logs
CREATE POLICY portal_logs_admin_all ON public.student_portal_access_logs FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Table 6: academic_sessions
CREATE POLICY sessions_admin_all ON public.academic_sessions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY sessions_read_auth ON public.academic_sessions FOR SELECT TO authenticated USING (true);

-- Table 7: academic_terms
CREATE POLICY terms_admin_all ON public.academic_terms FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY terms_read_auth ON public.academic_terms FOR SELECT TO authenticated USING (true);

-- Table 8: classes
CREATE POLICY classes_admin_all ON public.classes FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY classes_read_auth ON public.classes FOR SELECT TO authenticated USING (true);

-- Table 9: sections
CREATE POLICY sections_admin_all ON public.sections FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY sections_read_auth ON public.sections FOR SELECT TO authenticated USING (true);

-- Table 10: class_teacher_assignments
CREATE POLICY cta_admin_all ON public.class_teacher_assignments FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY cta_read_auth ON public.class_teacher_assignments FOR SELECT TO authenticated USING (true);

-- Table 11: subject_teacher_assignments
CREATE POLICY sta_admin_all ON public.subject_teacher_assignments FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY sta_read_auth ON public.subject_teacher_assignments FOR SELECT TO authenticated USING (true);

-- Table 12: students
CREATE POLICY students_admin_all ON public.students FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY students_read_teacher ON public.students FOR SELECT TO authenticated USING (public.is_teacher());
CREATE POLICY students_read_own ON public.students FOR SELECT TO authenticated USING (user_id = public.current_user_id());

-- Table 13: student_enrollments
CREATE POLICY enrollments_admin_all ON public.student_enrollments FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY enrollments_read_teacher ON public.student_enrollments FOR SELECT TO authenticated USING (public.is_teacher());
CREATE POLICY enrollments_read_own ON public.student_enrollments FOR SELECT TO authenticated USING (student_id = public.current_student_id());

-- Table 14: subjects
CREATE POLICY subjects_admin_all ON public.subjects FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY subjects_read_auth ON public.subjects FOR SELECT TO authenticated USING (true);

-- Table 15: student_subject_enrollments
CREATE POLICY sse_admin_all ON public.student_subject_enrollments FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY sse_read_teacher ON public.student_subject_enrollments FOR SELECT TO authenticated USING (public.is_teacher());
CREATE POLICY sse_read_own ON public.student_subject_enrollments FOR SELECT TO authenticated USING (
  enrollment_id IN (SELECT se.id FROM public.student_enrollments se WHERE se.student_id = public.current_student_id())
);

-- Table 16: results
CREATE POLICY results_admin_all ON public.results FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY results_teacher_select ON public.results FOR SELECT TO authenticated USING (public.is_teacher());
CREATE POLICY results_teacher_insert ON public.results FOR INSERT TO authenticated WITH CHECK (
  public.is_teacher() AND EXISTS (
    SELECT 1 FROM public.student_enrollments se
    WHERE se.id = enrollment_id AND public.teacher_assigned_to_subject(se.class_id, subject_id)
  )
);
CREATE POLICY results_teacher_update ON public.results FOR UPDATE TO authenticated USING (
  public.is_teacher() AND EXISTS (
    SELECT 1 FROM public.student_enrollments se
    WHERE se.id = enrollment_id AND public.teacher_assigned_to_subject(se.class_id, subject_id)
  )
) WITH CHECK (
  public.is_teacher() AND EXISTS (
    SELECT 1 FROM public.student_enrollments se
    WHERE se.id = enrollment_id AND public.teacher_assigned_to_subject(se.class_id, subject_id)
  )
);
-- Student can only read live results once the full term result is officially approved & published.
-- All intermediate checkpoint reports (PR1, PR2, PR3) are accessed via result_snapshots to prevent leaking draft exam marks.
CREATE POLICY results_student_read_published ON public.results FOR SELECT TO authenticated USING (
  public.is_student() AND
  enrollment_id IN (SELECT se.id FROM public.student_enrollments se WHERE se.student_id = public.current_student_id()) AND
  status = 'published'
);

-- Table 17: result_snapshots
CREATE POLICY snapshots_admin_all ON public.result_snapshots FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY snapshots_student_read ON public.result_snapshots FOR SELECT TO authenticated USING (
  enrollment_id IN (SELECT se.id FROM public.student_enrollments se WHERE se.student_id = public.current_student_id())
);
-- NOTE: Blanket public QR read policy was REMOVED. Public QR verification is handled strictly via verify_result_snapshot() RPC!

-- Table 18: attendance_records
CREATE POLICY attendance_rec_admin_all ON public.attendance_records FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY attendance_rec_teacher_manage ON public.attendance_records FOR ALL TO authenticated USING (
  public.is_teacher() AND EXISTS (
    SELECT 1 FROM public.student_enrollments se
    WHERE se.id = enrollment_id AND public.teacher_is_class_master(se.class_id)
  )
) WITH CHECK (
  public.is_teacher() AND EXISTS (
    SELECT 1 FROM public.student_enrollments se
    WHERE se.id = enrollment_id AND public.teacher_is_class_master(se.class_id)
  )
);
CREATE POLICY attendance_rec_student_read ON public.attendance_records FOR SELECT TO authenticated USING (
  enrollment_id IN (SELECT se.id FROM public.student_enrollments se WHERE se.student_id = public.current_student_id())
);

-- Table 19: attendance_summaries
CREATE POLICY attendance_sum_admin_all ON public.attendance_summaries FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY attendance_sum_teacher_read ON public.attendance_summaries FOR SELECT TO authenticated USING (public.is_teacher());
CREATE POLICY attendance_sum_student_read ON public.attendance_summaries FOR SELECT TO authenticated USING (
  enrollment_id IN (SELECT se.id FROM public.student_enrollments se WHERE se.student_id = public.current_student_id())
);

-- Table 20: student_evaluations
CREATE POLICY evaluations_admin_all ON public.student_evaluations FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY evaluations_teacher_manage ON public.student_evaluations FOR ALL TO authenticated USING (
  public.is_teacher() AND EXISTS (
    SELECT 1 FROM public.student_enrollments se
    WHERE se.id = enrollment_id AND public.teacher_is_class_master(se.class_id)
  )
) WITH CHECK (
  public.is_teacher() AND EXISTS (
    SELECT 1 FROM public.student_enrollments se
    WHERE se.id = enrollment_id AND public.teacher_is_class_master(se.class_id)
  )
);
CREATE POLICY evaluations_student_read ON public.student_evaluations FOR SELECT TO authenticated USING (
  enrollment_id IN (SELECT se.id FROM public.student_enrollments se WHERE se.student_id = public.current_student_id())
);

-- Table 21: signatures
CREATE POLICY signatures_admin_all ON public.signatures FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY signatures_teacher_manage ON public.signatures FOR ALL TO authenticated USING (user_id = public.current_user_id()) WITH CHECK (user_id = public.current_user_id());
CREATE POLICY signatures_read_auth ON public.signatures FOR SELECT TO authenticated USING (is_active = true);

-- Table 22: cbt_exams
CREATE POLICY cbt_exams_admin_all ON public.cbt_exams FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY cbt_exams_teacher_manage ON public.cbt_exams FOR ALL TO authenticated USING (public.is_teacher()) WITH CHECK (public.is_teacher());
CREATE POLICY cbt_exams_student_read ON public.cbt_exams FOR SELECT TO authenticated USING (public.is_student() AND is_published = true);

-- Table 23: cbt_questions
CREATE POLICY cbt_questions_admin_all ON public.cbt_questions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY cbt_questions_teacher_manage ON public.cbt_questions FOR ALL TO authenticated USING (public.is_teacher()) WITH CHECK (public.is_teacher());
CREATE POLICY cbt_questions_student_read ON public.cbt_questions FOR SELECT TO authenticated USING (
  public.is_student() AND EXISTS (SELECT 1 FROM public.cbt_exams ce WHERE ce.id = exam_id AND ce.is_published = true)
);

-- Table 24: cbt_submissions
CREATE POLICY cbt_submissions_admin_all ON public.cbt_submissions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY cbt_submissions_teacher_manage ON public.cbt_submissions FOR ALL TO authenticated USING (public.is_teacher()) WITH CHECK (public.is_teacher());
CREATE POLICY cbt_submissions_student_insert ON public.cbt_submissions FOR INSERT TO authenticated WITH CHECK (
  student_id = public.current_student_id()
);
CREATE POLICY cbt_submissions_student_select ON public.cbt_submissions FOR SELECT TO authenticated USING (
  student_id = public.current_student_id()
);

-- Table 25: fee_structures
CREATE POLICY fees_admin_all ON public.fee_structures FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY fees_read_auth ON public.fee_structures FOR SELECT TO authenticated USING (true);

-- Table 26: payment_gateway_configs (Strictly Admin / Service Role ONLY)
CREATE POLICY gateway_cfg_admin_all ON public.payment_gateway_configs FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Table 27: payment_invoices
CREATE POLICY invoices_admin_all ON public.payment_invoices FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY invoices_student_read ON public.payment_invoices FOR SELECT TO authenticated USING (student_id = public.current_student_id());

-- Table 28: payment_transactions
CREATE POLICY tx_admin_all ON public.payment_transactions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY tx_student_read ON public.payment_transactions FOR SELECT TO authenticated USING (
  invoice_id IN (SELECT pi.id FROM public.payment_invoices pi WHERE pi.student_id = public.current_student_id())
);

-- Table 29: admission_forms
CREATE POLICY forms_admin_all ON public.admission_forms FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY forms_public_read ON public.admission_forms FOR SELECT TO anon, authenticated USING (status = 'active');

-- Table 30: admission_payments
CREATE POLICY adm_pay_admin_all ON public.admission_payments FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY adm_pay_public_insert ON public.admission_payments FOR INSERT TO anon, authenticated WITH CHECK (true);
-- Scope anon SELECT strictly to the payment_reference the client possesses (or query via lookup_admission_payment_by_ref)
CREATE POLICY adm_pay_public_select ON public.admission_payments FOR SELECT TO anon USING (
  payment_reference = coalesce(
    current_setting('request.headers', true)::json->>'x-payment-reference',
    '__DENY_EMPTY_REFERENCE__'
  )
);

-- Table 31: admissions
CREATE POLICY admissions_admin_all ON public.admissions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admissions_public_insert ON public.admissions FOR INSERT TO anon, authenticated WITH CHECK (true);
-- Scope anon SELECT strictly to the application_number the client possesses (or query via lookup_admission_by_number)
CREATE POLICY admissions_public_select ON public.admissions FOR SELECT TO anon USING (
  application_number = coalesce(
    current_setting('request.headers', true)::json->>'x-application-number',
    '__DENY_EMPTY_APPLICATION_NO__'
  )
);

-- Table 32: admissions_audit
CREATE POLICY adm_audit_admin_all ON public.admissions_audit FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Table 33: promotions
CREATE POLICY promotions_admin_all ON public.promotions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY promotions_teacher_read ON public.promotions FOR SELECT TO authenticated USING (public.is_teacher());

-- Table 34: alumni_students
CREATE POLICY alumni_admin_all ON public.alumni_students FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY alumni_read_auth ON public.alumni_students FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- SECURE PUBLIC DIRECTORIES & RPC FUNCTIONS (Fixes 1, 2, 6)
-- ----------------------------------------------------------------------------

-- Fix 6: Public Teachers Directory (Hides teacher email/phone from students)
CREATE OR REPLACE VIEW public.teachers_directory AS
SELECT 
  u.id,
  u.display_name,
  u.staff_id,
  u.role
FROM public.users u
WHERE u.role = 'teacher' AND u.status = 'active';

GRANT SELECT ON public.teachers_directory TO authenticated;

-- Fix 2: Cryptographic Result Snapshot Verification RPC
-- Takes the verification token as a parameter and returns strictly one matching record.
-- Completely eliminates blanket anonymous SELECT on result_snapshots.
CREATE OR REPLACE FUNCTION public.verify_result_snapshot(p_token text)
RETURNS TABLE (
  id uuid,
  enrollment_id uuid,
  student_name text,
  admission_no text,
  class_name text,
  session_name text,
  term public.term_code_enum,
  report_type public.report_type_enum,
  snapshot_data jsonb,
  verification_token text,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    rs.id,
    rs.enrollment_id,
    st.full_name AS student_name,
    st.admission_no,
    c.name AS class_name,
    s.name AS session_name,
    rs.term,
    rs.report_type,
    rs.snapshot_data,
    rs.verification_token,
    rs.published_at
  FROM public.result_snapshots rs
  JOIN public.student_enrollments se ON se.id = rs.enrollment_id
  JOIN public.students st ON st.id = se.student_id
  JOIN public.classes c ON c.id = se.class_id
  JOIN public.academic_sessions s ON s.id = se.academic_session_id
  WHERE rs.verification_token = p_token
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_result_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_result_snapshot(text) TO anon, authenticated;

-- Fix 1: Scoped Anonymous Lookup for Admissions by Application Number
CREATE OR REPLACE FUNCTION public.lookup_admission_by_number(p_application_number text)
RETURNS SETOF public.admissions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.admissions 
  WHERE application_number = p_application_number;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_admission_by_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_admission_by_number(text) TO anon, authenticated;

-- Fix 1: Scoped Anonymous Lookup for Admission Payments by Reference
CREATE OR REPLACE FUNCTION public.lookup_admission_payment_by_ref(p_payment_reference text)
RETURNS SETOF public.admission_payments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.admission_payments 
  WHERE payment_reference = p_payment_reference;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_admission_payment_by_ref(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_admission_payment_by_ref(text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- PERMISSIONS: Global Grants
-- ----------------------------------------------------------------------------
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
 */