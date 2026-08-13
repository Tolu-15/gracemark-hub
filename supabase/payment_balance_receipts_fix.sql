-- Gracemark payment, balance, receipt, and admin report fix
-- Run this entire file in Supabase SQL Editor.
-- It is idempotent and only touches finance/payment portal tables, policies, and RPC.

create extension if not exists pgcrypto;

-- Student portal access columns used by automatic unlock after payment.
alter table public.students add column if not exists portal_access_status text not null default 'ACTIVE';
alter table public.students add column if not exists portal_lock_reason text;
alter table public.students add column if not exists portal_locked_at timestamptz;
alter table public.students add column if not exists portal_locked_by uuid references public.users(auth_id) on delete set null;
alter table public.students drop constraint if exists students_portal_access_status_check;
alter table public.students add constraint students_portal_access_status_check check (portal_access_status in ('ACTIVE', 'LOCKED'));

-- Academic helpers.
create table if not exists public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_current boolean not null default false,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  term_code text not null unique check (term_code in ('term1', 'term2', 'term3')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.academic_terms (name, term_code, is_current)
values ('First Term', 'term1', true), ('Second Term', 'term2', false), ('Third Term', 'term3', false)
on conflict (term_code) do nothing;

-- Fee setup.
create table if not exists public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade,
  academic_session text,
  term text,
  fee_type text not null default 'School Fees',
  tuition_amount numeric(10, 2) not null default 0,
  registration_fee numeric(10, 2) not null default 0,
  exams_fee numeric(10, 2) not null default 0,
  facilities_fee numeric(10, 2) not null default 0,
  status text not null default 'active',
  due_date date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fee_structures add column if not exists school_id uuid references public.schools(id) on delete cascade;
alter table public.fee_structures add column if not exists class_id uuid references public.classes(id) on delete cascade;
alter table public.fee_structures add column if not exists academic_session text;
alter table public.fee_structures add column if not exists term text;
alter table public.fee_structures add column if not exists fee_type text not null default 'School Fees';
alter table public.fee_structures add column if not exists tuition_amount numeric(10, 2) not null default 0;
alter table public.fee_structures add column if not exists registration_fee numeric(10, 2) not null default 0;
alter table public.fee_structures add column if not exists exams_fee numeric(10, 2) not null default 0;
alter table public.fee_structures add column if not exists facilities_fee numeric(10, 2) not null default 0;
alter table public.fee_structures add column if not exists status text not null default 'active';
alter table public.fee_structures add column if not exists due_date date;
alter table public.fee_structures add column if not exists description text;
alter table public.fee_structures add column if not exists updated_at timestamptz not null default now();
alter table public.fee_structures drop constraint if exists fee_structures_status_check;
alter table public.fee_structures add constraint fee_structures_status_check check (status in ('active', 'inactive'));
create index if not exists fee_structures_class_idx on public.fee_structures(class_id);
create index if not exists fee_structures_session_idx on public.fee_structures(academic_session);

-- Invoices shown to students and admin reports.
create table if not exists public.payment_invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  fee_structure_id uuid references public.fee_structures(id) on delete set null,
  class_id uuid references public.classes(id) on delete set null,
  academic_session text,
  term text,
  total_amount numeric(10, 2) not null default 0,
  amount_paid numeric(10, 2) not null default 0,
  status text not null default 'UNPAID',
  due_date date,
  issued_date timestamptz not null default now(),
  invoice_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_invoices add column if not exists fee_structure_id uuid references public.fee_structures(id) on delete set null;
alter table public.payment_invoices add column if not exists class_id uuid references public.classes(id) on delete set null;
alter table public.payment_invoices add column if not exists academic_session text;
alter table public.payment_invoices add column if not exists term text;
alter table public.payment_invoices add column if not exists total_amount numeric(10, 2) not null default 0;
alter table public.payment_invoices add column if not exists amount_paid numeric(10, 2) not null default 0;
alter table public.payment_invoices add column if not exists status text not null default 'UNPAID';
alter table public.payment_invoices add column if not exists due_date date;
alter table public.payment_invoices add column if not exists issued_date timestamptz not null default now();
alter table public.payment_invoices add column if not exists invoice_number text;
alter table public.payment_invoices add column if not exists notes text;
alter table public.payment_invoices add column if not exists updated_at timestamptz not null default now();

update public.payment_invoices
set invoice_number = 'INV-MIG-' || replace(id::text, '-', '')
where invoice_number is null or invoice_number = '';

alter table public.payment_invoices alter column invoice_number set not null;
alter table public.payment_invoices drop constraint if exists payment_invoices_status_check;
alter table public.payment_invoices add constraint payment_invoices_status_check check (status in ('UNPAID', 'PARTIALLY PAID', 'FULLY PAID', 'draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'));

create unique index if not exists payment_invoices_invoice_number_idx on public.payment_invoices(invoice_number);
create index if not exists payment_invoices_student_id_idx on public.payment_invoices(student_id);
create index if not exists payment_invoices_session_term_idx on public.payment_invoices(academic_session, term);

-- Use a non-unique index here because older data may contain multiple invoices for one student/session/term.
create index if not exists payment_invoices_student_session_term_lookup_idx on public.payment_invoices(student_id, academic_session, term);

-- Payment ledger/receipts.
create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.payment_invoices(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  payment_reference text,
  receipt_number text,
  amount numeric(10, 2) not null default 0,
  payment_gateway text not null default 'paystack',
  gateway_response jsonb,
  status text not null default 'pending',
  payment_date timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references public.users(auth_id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.payment_records add column if not exists student_id uuid references public.students(id) on delete cascade;
alter table public.payment_records add column if not exists payment_reference text;
alter table public.payment_records add column if not exists receipt_number text;
alter table public.payment_records add column if not exists gateway_response jsonb;
alter table public.payment_records add column if not exists verified_at timestamptz;
alter table public.payment_records add column if not exists verified_by uuid references public.users(auth_id) on delete set null;

update public.payment_records
set payment_reference = 'PAY-MIG-' || replace(id::text, '-', '')
where payment_reference is null or payment_reference = '';

alter table public.payment_records alter column payment_reference set not null;
alter table public.payment_records drop constraint if exists payment_records_status_check;
alter table public.payment_records add constraint payment_records_status_check check (status in ('pending', 'successful', 'success', 'failed', 'cancelled'));
alter table public.payment_records drop constraint if exists payment_records_payment_gateway_check;
alter table public.payment_records add constraint payment_records_payment_gateway_check check (payment_gateway in ('paystack', 'flutterwave', 'manual'));

create unique index if not exists payment_records_payment_reference_idx on public.payment_records(payment_reference);
create unique index if not exists payment_records_receipt_number_idx on public.payment_records(receipt_number) where receipt_number is not null;
create index if not exists payment_records_student_idx on public.payment_records(student_id);
create index if not exists payment_records_invoice_idx on public.payment_records(invoice_id);

-- Portal fee-lock settings.
create table if not exists public.portal_access_settings (
  id uuid primary key default gen_random_uuid(),
  restrict_outstanding_fees boolean not null default false,
  lock_after_due_date boolean not null default false,
  grace_period_days int not null default 7,
  auto_unlock_on_full_payment boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.portal_access_settings (restrict_outstanding_fees, lock_after_due_date, grace_period_days, auto_unlock_on_full_payment)
select false, false, 7, true
where not exists (select 1 from public.portal_access_settings);

-- RLS and policies.
alter table public.academic_sessions enable row level security;
alter table public.academic_terms enable row level security;
alter table public.fee_structures enable row level security;
alter table public.payment_invoices enable row level security;
alter table public.payment_records enable row level security;
alter table public.portal_access_settings enable row level security;

drop policy if exists fee_structures_admin_all on public.fee_structures;
create policy fee_structures_admin_all on public.fee_structures for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists fee_structures_read_auth on public.fee_structures;
create policy fee_structures_read_auth on public.fee_structures for select using (auth.role() = 'authenticated');

drop policy if exists payment_invoices_admin_all on public.payment_invoices;
create policy payment_invoices_admin_all on public.payment_invoices for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists payment_invoices_student_read on public.payment_invoices;
drop policy if exists payment_invoices_student_all on public.payment_invoices;
create policy payment_invoices_student_all on public.payment_invoices for all
  using (public.is_student() and student_id = public.current_student_id())
  with check (public.is_student() and student_id = public.current_student_id());

drop policy if exists payment_records_admin_all on public.payment_records;
create policy payment_records_admin_all on public.payment_records for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists payment_records_student_read on public.payment_records;
drop policy if exists payment_records_student_all on public.payment_records;
create policy payment_records_student_all on public.payment_records for all
  using (public.is_student() and student_id = public.current_student_id())
  with check (public.is_student() and student_id = public.current_student_id());

drop policy if exists portal_settings_admin_all on public.portal_access_settings;
create policy portal_settings_admin_all on public.portal_access_settings for all using (public.is_admin()) with check (public.is_admin());

grant all on table public.fee_structures to authenticated, service_role;
grant all on table public.payment_invoices to authenticated, service_role;
grant all on table public.payment_records to authenticated, service_role;
grant all on table public.portal_access_settings to authenticated, service_role;

-- Authoritative payment recording RPC. Student portal calls this when server verification is unavailable.
create or replace function public.record_student_payment(
  p_invoice_id uuid,
  p_student_id uuid,
  p_reference text,
  p_amount numeric,
  p_receipt_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice payment_invoices%rowtype;
  v_total_paid numeric;
  v_balance numeric;
  v_new_status text;
  v_existing_rec payment_records%rowtype;
begin
  if p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Invalid payment amount');
  end if;

  select * into v_existing_rec from payment_records where payment_reference = p_reference limit 1;
  if found and v_existing_rec.status in ('successful', 'success') then
    select coalesce(sum(amount), 0) into v_total_paid
    from payment_records
    where invoice_id = v_existing_rec.invoice_id and status in ('successful', 'success');

    select * into v_invoice from payment_invoices where id = v_existing_rec.invoice_id;
    v_balance := greatest(0, coalesce(v_invoice.total_amount, 0) - v_total_paid);

    return jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'receipt_number', v_existing_rec.receipt_number,
      'total_paid', v_total_paid,
      'outstanding_balance', v_balance,
      'status', v_invoice.status
    );
  end if;

  select * into v_invoice from payment_invoices where id = p_invoice_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found');
  end if;

  if v_invoice.student_id <> p_student_id then
    return jsonb_build_object('ok', false, 'error', 'Invoice does not belong to this student');
  end if;

  insert into payment_records (
    invoice_id, student_id, payment_reference, receipt_number,
    amount, payment_gateway, status, payment_date, verified_at
  ) values (
    p_invoice_id, p_student_id, p_reference, p_receipt_number,
    p_amount, 'paystack', 'successful', now(), now()
  )
  on conflict (payment_reference) do update
    set receipt_number = coalesce(payment_records.receipt_number, excluded.receipt_number),
        amount = excluded.amount,
        status = 'successful',
        verified_at = now();

  select coalesce(sum(amount), 0) into v_total_paid
  from payment_records
  where invoice_id = p_invoice_id and status in ('successful', 'success');

  v_balance := greatest(0, v_invoice.total_amount - v_total_paid);
  if v_balance <= 0 and v_invoice.total_amount > 0 then
    v_new_status := 'FULLY PAID';
  elsif v_total_paid > 0 then
    v_new_status := 'PARTIALLY PAID';
  else
    v_new_status := 'UNPAID';
  end if;

  update payment_invoices
  set amount_paid = v_total_paid, status = v_new_status, updated_at = now()
  where id = p_invoice_id;

  if v_new_status = 'FULLY PAID' then
    update students
    set portal_access_status = 'ACTIVE', portal_lock_reason = null
    where id = p_student_id and portal_access_status = 'LOCKED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'receipt_number', p_receipt_number,
    'total_paid', v_total_paid,
    'outstanding_balance', v_balance,
    'status', v_new_status
  );
end;
$$;

grant execute on function public.record_student_payment(uuid, uuid, text, numeric, text) to authenticated;
notify pgrst, 'reload schema';
