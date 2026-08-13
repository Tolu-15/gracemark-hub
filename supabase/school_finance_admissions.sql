-- Migration: Gracemark Academy Full School Fees, Payment & Admissions Management Schema
-- Apply in Supabase SQL Editor.

-- ─── 1. Academic Sessions Table ────────────────────────────────────────────────
create table if not exists public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- e.g. '2025/2026', '2026/2027'
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_current boolean not null default false,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

-- ─── 2. Academic Terms Table ───────────────────────────────────────────────────
create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  name text not null, -- 'First Term', 'Second Term', 'Third Term'
  term_code text not null unique check (term_code in ('term1', 'term2', 'term3')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

-- Initial default terms
insert into public.academic_terms (name, term_code, is_current)
values 
  ('First Term', 'term1', true),
  ('Second Term', 'term2', false),
  ('Third Term', 'term3', false)
on conflict (term_code) do nothing;

-- ─── 3. Upgrade Students Table (Portal Access Control Columns) ──────────────────
alter table public.students add column if not exists portal_access_status text not null default 'ACTIVE' check (portal_access_status in ('ACTIVE', 'LOCKED'));
alter table public.students add column if not exists portal_lock_reason text;
alter table public.students add column if not exists portal_locked_at timestamptz;
alter table public.students add column if not exists portal_locked_by uuid references public.users(auth_id) on delete set null;

-- ─── 4. Upgrade / Create Fee Structures Table ──────────────────────────────────
create table if not exists public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  academic_session text not null, -- e.g., '2026/2027'
  term text not null, -- e.g., 'term1', 'term2', 'term3' or 'First Term'
  fee_type text not null default 'School Fees', -- e.g. 'School Fees', 'Tuition', 'Development Fee'
  tuition_amount numeric(10, 2) not null default 0.00,
  registration_fee numeric(10, 2) not null default 0.00,
  exams_fee numeric(10, 2) not null default 0.00,
  facilities_fee numeric(10, 2) not null default 0.00,
  status text not null default 'active' check (status in ('active', 'inactive')),
  due_date date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fee_structures_class_idx on public.fee_structures(class_id);
create index if not exists fee_structures_session_idx on public.fee_structures(academic_session);

-- ─── 5. Upgrade / Create Payment Invoices Table ────────────────────────────────
create table if not exists public.payment_invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  fee_structure_id uuid references public.fee_structures(id) on delete set null,
  class_id uuid references public.classes(id) on delete set null,
  academic_session text not null,
  term text not null,
  total_amount numeric(10, 2) not null default 0.00,
  amount_paid numeric(10, 2) not null default 0.00,
  status text not null default 'UNPAID' check (status in ('UNPAID', 'PARTIALLY PAID', 'FULLY PAID', 'draft', 'issued', 'partially_paid', 'paid', 'overdue')),
  due_date date,
  issued_date timestamptz not null default now(),
  invoice_number text unique not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, academic_session, term)
);

create index if not exists payment_invoices_student_id_idx on public.payment_invoices(student_id);

-- ─── 6. Upgrade / Create Payment Records Table ─────────────────────────────────
create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.payment_invoices(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  payment_reference text unique not null, -- Paystack reference (e.g. PAY-123456)
  receipt_number text unique, -- Unique receipt number (e.g. REC-2026-000123)
  amount numeric(10, 2) not null default 0.00,
  payment_gateway text not null default 'paystack' check (payment_gateway in ('paystack', 'flutterwave', 'manual')),
  gateway_response jsonb,
  status text not null default 'pending' check (status in ('pending', 'successful', 'success', 'failed', 'cancelled')),
  payment_date timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references public.users(auth_id) on delete set null,
  created_at timestamptz not null default now(),
-- Ensure all missing columns exist on existing tables if created previously
alter table public.fee_structures add column if not exists due_date date;
alter table public.fee_structures add column if not exists term text;
alter table public.fee_structures add column if not exists fee_type text not null default 'School Fees';
alter table public.fee_structures add column if not exists status text not null default 'active';

alter table public.payment_invoices add column if not exists class_id uuid references public.classes(id) on delete set null;
alter table public.payment_invoices add column if not exists academic_session text;
alter table public.payment_invoices add column if not exists term text;

alter table public.payment_records add column if not exists student_id uuid references public.students(id) on delete cascade;
alter table public.payment_records add column if not exists receipt_number text unique;

alter table public.admissions add column if not exists admission_payment_id uuid references public.admission_payments(id) on delete set null;

-- Reload Supabase Schema Cache
notify pgrst, 'reload schema';
create index if not exists payment_records_student_idx on public.payment_records(student_id);
create index if not exists payment_records_reference_idx on public.payment_records(payment_reference);

-- ─── 7. Portal Access Settings Table ──────────────────────────────────────────
create table if not exists public.portal_access_settings (
  id uuid primary key default gen_random_uuid(),
  restrict_outstanding_fees boolean not null default false,
  lock_after_due_date boolean not null default false,
  grace_period_days int not null default 7,
  auto_unlock_on_full_payment boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Seed default settings if empty
insert into public.portal_access_settings (restrict_outstanding_fees, lock_after_due_date, grace_period_days)
select false, false, 7
where not exists (select 1 from public.portal_access_settings);

-- ─── 8. Student Portal Access Audit Logs Table ────────────────────────────────
create table if not exists public.student_portal_access_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  action text not null check (action in ('LOCKED', 'UNLOCKED')),
  reason text,
  performed_by uuid references public.users(auth_id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─── 9. Admission Forms Table ─────────────────────────────────────────────────
create table if not exists public.admission_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null, -- e.g. '2026/2027 Admission Form'
  academic_session text not null,
  amount numeric(10, 2) not null default 0.00,
  status text not null default 'active' check (status in ('active', 'inactive')),
  description text,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── 10. Admission Form Payments Table ───────────────────────────────────────
create table if not exists public.admission_payments (
  id uuid primary key default gen_random_uuid(),
  admission_form_id uuid references public.admission_forms(id) on delete set null,
  payment_reference text unique not null,
  receipt_number text unique,
  amount numeric(10, 2) not null default 0.00,
  applicant_email text not null,
  applicant_phone text,
  payment_gateway text default 'paystack',
  gateway_response jsonb,
  status text not null default 'pending' check (status in ('pending', 'successful', 'success', 'failed', 'cancelled')),
  payment_date timestamptz not null default now(),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- Upgrade Admissions table to reference admission_payments
alter table public.admissions add column if not exists admission_payment_id uuid references public.admission_payments(id) on delete set null;

-- ─── RLS Policies ────────────────────────────────────────────────────────────
alter table public.academic_sessions enable row level security;
alter table public.academic_terms enable row level security;
alter table public.fee_structures enable row level security;
alter table public.payment_invoices enable row level security;
alter table public.payment_records enable row level security;
alter table public.portal_access_settings enable row level security;
alter table public.student_portal_access_logs enable row level security;
alter table public.admission_forms enable row level security;
alter table public.admission_payments enable row level security;

-- Admin policies (Full Access)
drop policy if exists academic_sessions_admin_all on public.academic_sessions;
create policy academic_sessions_admin_all on public.academic_sessions for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists academic_terms_admin_all on public.academic_terms;
create policy academic_terms_admin_all on public.academic_terms for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists fee_structures_admin_all on public.fee_structures;
create policy fee_structures_admin_all on public.fee_structures for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payment_invoices_admin_all on public.payment_invoices;
create policy payment_invoices_admin_all on public.payment_invoices for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payment_records_admin_all on public.payment_records;
create policy payment_records_admin_all on public.payment_records for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists portal_settings_admin_all on public.portal_access_settings;
create policy portal_settings_admin_all on public.portal_access_settings for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists admission_forms_admin_all on public.admission_forms;
create policy admission_forms_admin_all on public.admission_forms for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists admission_payments_admin_all on public.admission_payments;
create policy admission_payments_admin_all on public.admission_payments for all using (public.is_admin()) with check (public.is_admin());

-- Read/Write policies for authenticated / students
drop policy if exists fee_structures_read_auth on public.fee_structures;
create policy fee_structures_read_auth on public.fee_structures for select using (auth.role() = 'authenticated');

drop policy if exists payment_invoices_student_read on public.payment_invoices;
drop policy if exists payment_invoices_student_all on public.payment_invoices;
create policy payment_invoices_student_all on public.payment_invoices for all using (
  public.is_student() and student_id = public.current_student_id()
) with check (
  public.is_student() and student_id = public.current_student_id()
);

drop policy if exists payment_records_student_read on public.payment_records;
drop policy if exists payment_records_student_all on public.payment_records;
create policy payment_records_student_all on public.payment_records for all using (
  public.is_student() and student_id = public.current_student_id()
) with check (
  public.is_student() and student_id = public.current_student_id()
);

drop policy if exists admission_forms_public_read on public.admission_forms;
create policy admission_forms_public_read on public.admission_forms for select using (true);

drop policy if exists admission_payments_public_insert on public.admission_payments;
create policy admission_payments_public_insert on public.admission_payments for insert with check (true);

drop policy if exists admission_payments_public_select on public.admission_payments;
create policy admission_payments_public_select on public.admission_payments for select using (true);

-- Table Grants
grant all on table public.academic_sessions to authenticated, service_role;
grant all on table public.academic_terms to authenticated, service_role;
grant all on table public.fee_structures to authenticated, service_role;
grant all on table public.payment_invoices to authenticated, service_role;
grant all on table public.payment_records to authenticated, service_role;
grant all on table public.portal_access_settings to authenticated, service_role;
grant all on table public.student_portal_access_logs to authenticated, service_role;
grant all on table public.admission_forms to anon, authenticated, service_role;
grant all on table public.admission_payments to anon, authenticated, service_role;
