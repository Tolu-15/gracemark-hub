create table public.result_corrections (
 id uuid primary key default gen_random_uuid(), enrollment_id uuid not null references public.student_enrollments(id),
 term public.term_code_enum not null, milestone public.report_type_enum not null, subject_id uuid not null,
 subject_name text not null, published_at timestamptz not null, concern text not null, response text,
 responded_by uuid references public.users(id), responded_at timestamptz, created_at timestamptz not null default now()
);
create unique index correction_open_subject on public.result_corrections(enrollment_id,term,milestone,subject_id) where response is null;
create table public.support_policy (id boolean primary key default true check(id), threshold numeric not null check(threshold between 0 and 100));
create table public.support_notes (
 id uuid primary key default gen_random_uuid(), enrollment_id uuid not null references public.student_enrollments(id),
 subject_id uuid not null, subject_name text not null, evidence jsonb not null, threshold numeric not null,
 note text not null, author uuid not null references public.users(id), created_at timestamptz not null default now()
);
alter table public.result_corrections enable row level security;
alter table public.support_policy enable row level security;
alter table public.support_notes enable row level security;
revoke all on public.result_corrections,public.support_policy,public.support_notes from public,anon,authenticated;
grant all on public.result_corrections,public.support_policy,public.support_notes to service_role;
alter table public.scratch_card_purchases add column resolution text check(resolution in ('refund','credit')),
 add column resolution_note text, add column resolved_at timestamptz, add column resolved_by uuid references public.users(id),
 add constraint consistent_duplicate_resolution check(resolution is null or
 (status='duplicate' and ((resolution='credit' and refunded_amount=0) or (resolution='refund' and refunded_amount=amount))));

-- Freeze the original card reference at the time the duplicate is recognised.
alter table public.scratch_card_purchases add column original_reference text;
create function public.link_duplicate_card() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='duplicate' and new.original_reference is null then
  select coalesce(c.payment_reference,c.serial) into new.original_reference from public.scratch_cards c
  where c.student_id=new.student_id and c.academic_session_id=new.academic_session_id and c.term_code=new.term_code
    and c.created_at<=new.updated_at order by c.created_at desc limit 1;
 end if;
 return new;
end $$;
create trigger link_duplicate_card before insert or update of status on public.scratch_card_purchases for each row execute function public.link_duplicate_card();
update public.scratch_card_purchases set status='duplicate' where status='duplicate';
revoke all on function public.link_duplicate_card() from public,anon,authenticated;
create view public.duplicate_card_payments with (security_invoker=true) as
 select p.id,p.student_id,s.name as student_name,a.name as session,p.term_code,p.reference,p.original_reference,p.amount,
 p.refunded_amount,coalesce(p.resolution,case when p.refunded_amount=p.amount then 'refund' end) as resolution,p.resolution_note,p.created_at
 from public.scratch_card_purchases p join public.students s on s.id=p.student_id
 join public.academic_sessions a on a.id=p.academic_session_id where p.status='duplicate';
revoke all on public.duplicate_card_payments from public,anon,authenticated;
grant select on public.duplicate_card_payments to service_role;

-- Only the excess above the invoiced fee is available for resolution.
create table public.fee_payment_resolutions (
 transaction_id uuid primary key references public.payment_transactions(id),
 amount numeric not null check(amount>0), kind text not null check(kind in ('refund','credit')),
 note text not null, recorded_by uuid not null references public.users(id), recorded_at timestamptz not null default now()
);
alter table public.fee_payment_resolutions enable row level security;
revoke all on public.fee_payment_resolutions from public,anon,authenticated;
grant all on public.fee_payment_resolutions to service_role;
create view public.duplicate_fee_payments with (security_invoker=true) as
with ledger as (
 select t.id,t.payment_reference as reference,t.paid_at as created_at,t.invoice_id,t.amount,
 lag(t.payment_reference) over w as original_reference,sum(t.amount) over w as cumulative
 from public.payment_transactions t where t.status='success'
 window w as (partition by t.invoice_id order by t.paid_at,t.id rows unbounded preceding)
)
select l.id,i.student_id,s.name as student_name,a.name as session,f.term as term_code,l.reference,l.original_reference,
 coalesce(r.amount,least(l.amount,l.cumulative-i.total_amount)) as amount,
 case when r.kind='refund' then r.amount else 0 end as refunded_amount,r.kind as resolution,r.note as resolution_note,l.created_at
 from ledger l join public.payment_invoices i on i.id=l.invoice_id join public.students s on s.id=i.student_id
 join public.fee_structures f on f.id=i.fee_structure_id join public.academic_sessions a on a.id=f.academic_session_id
 left join public.fee_payment_resolutions r on r.transaction_id=l.id
 where r.transaction_id is not null or (l.original_reference is not null and l.cumulative>i.total_amount);
revoke all on public.duplicate_fee_payments from public,anon,authenticated;
grant select on public.duplicate_fee_payments to service_role;
