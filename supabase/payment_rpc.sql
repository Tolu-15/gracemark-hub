-- ═══════════════════════════════════════════════════════════════════════════════
-- GRACEMARK PAYMENT FIX — Run this entire block in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Add missing unique constraint on payment_invoices ────────────────────
-- (The table schema defined it but ALTER TABLE doesn't add it if table existed)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_invoices_student_id_academic_session_term_key'
      and conrelid = 'public.payment_invoices'::regclass
  ) then
    alter table public.payment_invoices
      add constraint payment_invoices_student_id_academic_session_term_key
      unique (student_id, academic_session, term);
  end if;
end $$;

-- ─── 2. Fix payment_invoices status CHECK constraint ─────────────────────────
-- The old constraint may not include 'UNPAID', 'PARTIALLY PAID', 'FULLY PAID'
-- which are the values used by the app. Drop & recreate it to include all values.
alter table public.payment_invoices
  drop constraint if exists payment_invoices_status_check;

alter table public.payment_invoices
  add constraint payment_invoices_status_check
  check (status in (
    'UNPAID', 'PARTIALLY PAID', 'FULLY PAID',
    'draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'
  ));

-- ─── 3. Ensure payment_records has unique constraint on payment_reference ─────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_records_payment_reference_key'
      and conrelid = 'public.payment_records'::regclass
  ) then
    alter table public.payment_records
      add constraint payment_records_payment_reference_key
      unique (payment_reference);
  end if;
end $$;

-- ─── 4. Ensure receipt_number is unique on payment_records ───────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_records_receipt_number_key'
      and conrelid = 'public.payment_records'::regclass
  ) then
    alter table public.payment_records
      add constraint payment_records_receipt_number_key
      unique (receipt_number);
  end if;
end $$;


-- ─── 4. RLS Policies: grant students full write on their own invoices/records ─
drop policy if exists payment_invoices_student_read on public.payment_invoices;
drop policy if exists payment_invoices_student_all on public.payment_invoices;
create policy payment_invoices_student_all on public.payment_invoices for all
  using (public.is_student() and student_id = public.current_student_id())
  with check (public.is_student() and student_id = public.current_student_id());

drop policy if exists payment_records_student_read on public.payment_records;
drop policy if exists payment_records_student_all on public.payment_records;
create policy payment_records_student_all on public.payment_records for all
  using (public.is_student() and student_id = public.current_student_id())
  with check (public.is_student() and student_id = public.current_student_id());

-- Table grants
grant all on table public.payment_invoices to authenticated, service_role;
grant all on table public.payment_records to authenticated, service_role;

-- ─── 5. Payment Recording RPC (SECURITY DEFINER bypasses RLS) ────────────────
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
  -- Prevent duplicate processing
  select * into v_existing_rec
  from payment_records
  where payment_reference = p_reference
  limit 1;

  if found and (v_existing_rec.status = 'successful' or v_existing_rec.status = 'success') then
    return jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'receipt_number', v_existing_rec.receipt_number
    );
  end if;

  -- Get invoice
  select * into v_invoice
  from payment_invoices
  where id = p_invoice_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found');
  end if;

  -- Insert payment record (security definer bypasses RLS)
  insert into payment_records (
    invoice_id, student_id, payment_reference, receipt_number,
    amount, payment_gateway, status, payment_date, verified_at
  ) values (
    p_invoice_id, p_student_id, p_reference, p_receipt_number,
    p_amount, 'paystack', 'successful', now(), now()
  )
  on conflict (payment_reference) do update
    set status = 'successful', verified_at = now();

  -- Recalculate total verified paid from all records
  select coalesce(sum(amount), 0) into v_total_paid
  from payment_records
  where invoice_id = p_invoice_id
    and status in ('successful', 'success');

  -- Calculate new invoice status
  v_balance := greatest(0, v_invoice.total_amount - v_total_paid);
  if v_balance <= 0 and v_invoice.total_amount > 0 then
    v_new_status := 'FULLY PAID';
  elsif v_total_paid > 0 then
    v_new_status := 'PARTIALLY PAID';
  else
    v_new_status := 'UNPAID';
  end if;

  -- Update invoice amount_paid and status
  update payment_invoices
  set amount_paid = v_total_paid,
      status = v_new_status,
      updated_at = now()
  where id = p_invoice_id;

  -- Auto-unlock student portal if fully paid
  if v_new_status = 'FULLY PAID' then
    update students
    set portal_access_status = 'ACTIVE',
        portal_lock_reason = null
    where id = p_student_id
      and portal_access_status = 'LOCKED';
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

-- Grant execute to authenticated users (students call this via RPC)
grant execute on function public.record_student_payment(uuid, uuid, text, numeric, text) to authenticated;

-- Reload schema cache
notify pgrst, 'reload schema';

