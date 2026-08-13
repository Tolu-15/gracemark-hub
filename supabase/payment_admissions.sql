-- Migration: Payment Gateway & Online Admissions Schema
-- Apply in Supabase SQL editor.

-- ─── 1. Fee Structures Table ──────────────────────────────────────────────────
create table if not exists public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  academic_session text not null, -- e.g., '2024/2025'
  tuition_amount numeric(10, 2) not null default 0.00,
  registration_fee numeric(10, 2) not null default 0.00,
  exams_fee numeric(10, 2) not null default 0.00,
  facilities_fee numeric(10, 2) not null default 0.00,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, class_id, academic_session)
);

create index if not exists fee_structures_class_id_idx on public.fee_structures(class_id);

-- ─── 2. Payment Invoices Table ────────────────────────────────────────────────
create table if not exists public.payment_invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  fee_structure_id uuid references public.fee_structures(id) on delete set null,
  total_amount numeric(10, 2) not null default 0.00,
  amount_paid numeric(10, 2) not null default 0.00,
  status text not null default 'draft' check (status in ('draft', 'issued', 'partially_paid', 'paid', 'overdue')),
  due_date date,
  issued_date timestamptz not null default now(),
  invoice_number text unique not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_invoices_student_id_idx on public.payment_invoices(student_id);
create index if not exists payment_invoices_invoice_number_idx on public.payment_invoices(invoice_number);

-- ─── 3. Payment Records Table ─────────────────────────────────────────────────
create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.payment_invoices(id) on delete cascade,
  payment_reference text unique not null, -- Paystack / Flutterwave reference
  amount numeric(10, 2) not null default 0.00,
  payment_gateway text check (payment_gateway in ('paystack', 'flutterwave', 'manual')),
  gateway_response jsonb,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'cancelled')),
  payment_date timestamptz,
  verified_at timestamptz,
  verified_by uuid references public.users(auth_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_records_invoice_id_idx on public.payment_records(invoice_id);
create index if not exists payment_records_reference_idx on public.payment_records(payment_reference);

-- ─── 4. Payment Gateway Configuration Table ──────────────────────────────────
create table if not exists public.payment_config (
  id uuid primary key default gen_random_uuid(),
  school_id uuid unique not null references public.schools(id) on delete cascade,
  gateway_type text check (gateway_type in ('paystack', 'flutterwave')) default 'paystack',
  public_key text not null,
  secret_key text not null,
  webhook_secret text,
  is_live boolean default false,
  enabled boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── 5. Admissions Application Table ─────────────────────────────────────────
create table if not exists public.admissions (
  id uuid primary key default gen_random_uuid(),
  admission_number text unique,
  surname text not null,
  first_names text not null,
  date_of_birth date,
  gender text check (gender in ('M', 'F')),
  nationality text default 'Nigerian',
  state_of_origin text,
  religion text,
  home_address text,
  city text,
  state text,
  country text default 'Nigeria',
  passport_photo_url text,
  
  -- Education History
  previous_school_name text,
  previous_school_address text,
  previous_class text,
  
  -- Parent / Guardian Info
  parent_guardian_name text not null,
  parent_guardian_email text,
  parent_guardian_phone text not null,
  parent_guardian_address text,
  parent_guardian_occupation text,
  parent_guardian_religion text,
  
  -- Medical / Boarding Info
  is_boarding boolean default false,
  boarding_type text check (boarding_type in ('full', 'weekday')),
  dietary_requirements text,
  medical_conditions text,
  allergies text,
  
  -- Application Info
  desired_class text not null,
  special_skills text,
  referral_source text check (referral_source in ('teacher', 'student', 'electronic_media', 'handbill', 'social_media', 'parent', 'other')),
  referral_other text,
  
  -- Tracking & Status
  application_status text not null default 'draft' check (application_status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'enrolled')),
  invoice_id uuid references public.payment_invoices(id) on delete set null,
  created_student_id uuid references public.students(id) on delete set null,
  reviewed_by uuid references public.users(auth_id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admissions_status_idx on public.admissions(application_status);
create index if not exists admissions_number_idx on public.admissions(admission_number);

-- ─── 6. Admissions Audit Trail Table ─────────────────────────────────────────
create table if not exists public.admissions_audit (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id) on delete cascade,
  action text not null, -- 'submitted', 'approved', 'payment_received', 'account_created'
  performed_by uuid references public.users(auth_id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- ─── Triggers for updated_at ────────────────────────────────────────────────
drop trigger if exists set_fee_structures_updated_at on public.fee_structures;
create trigger set_fee_structures_updated_at before update on public.fee_structures for each row execute function public.set_updated_at();

drop trigger if exists set_payment_invoices_updated_at on public.payment_invoices;
create trigger set_payment_invoices_updated_at before update on public.payment_invoices for each row execute function public.set_updated_at();

drop trigger if exists set_payment_records_updated_at on public.payment_records;
create trigger set_payment_records_updated_at before update on public.payment_records for each row execute function public.set_updated_at();

drop trigger if exists set_payment_config_updated_at on public.payment_config;
create trigger set_payment_config_updated_at before update on public.payment_config for each row execute function public.set_updated_at();

drop trigger if exists set_admissions_updated_at on public.admissions;
create trigger set_admissions_updated_at before update on public.admissions for each row execute function public.set_updated_at();

-- ─── Row Level Security (RLS) ────────────────────────────────────────────────
alter table public.fee_structures enable row level security;
alter table public.payment_invoices enable row level security;
alter table public.payment_records enable row level security;
alter table public.payment_config enable row level security;
alter table public.admissions enable row level security;
alter table public.admissions_audit enable row level security;

-- Admin policies (Full access)
drop policy if exists fee_structures_admin_all on public.fee_structures;
create policy fee_structures_admin_all on public.fee_structures for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payment_invoices_admin_all on public.payment_invoices;
create policy payment_invoices_admin_all on public.payment_invoices for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payment_records_admin_all on public.payment_records;
create policy payment_records_admin_all on public.payment_records for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payment_config_admin_all on public.payment_config;
create policy payment_config_admin_all on public.payment_config for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists admissions_admin_all on public.admissions;
create policy admissions_admin_all on public.admissions for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists admissions_audit_admin_all on public.admissions_audit;
create policy admissions_audit_admin_all on public.admissions_audit for all using (public.is_admin()) with check (public.is_admin());

-- Anonymous / Public policy for online admissions application form submission
drop policy if exists admissions_anon_insert on public.admissions;
create policy admissions_anon_insert on public.admissions for insert with check (true);

drop policy if exists admissions_anon_select on public.admissions;
create policy admissions_anon_select on public.admissions for select using (true);

-- Student policies for own invoices
drop policy if exists payment_invoices_student_read on public.payment_invoices;
create policy payment_invoices_student_read on public.payment_invoices for select using (
  public.is_student() and student_id = public.current_student_id()
);

-- Grants
grant all on table public.fee_structures to authenticated, service_role;
grant all on table public.payment_invoices to authenticated, service_role;
grant all on table public.payment_records to authenticated, service_role;
grant all on table public.payment_config to authenticated, service_role;
grant all on table public.admissions to anon, authenticated, service_role;
grant all on table public.admissions_audit to authenticated, service_role;
