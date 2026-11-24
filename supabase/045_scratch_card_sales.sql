-- Amounts are cumulative refunds already paid by the school, recorded in naira.
alter table public.scratch_cards add column refunded_amount numeric(12,2) not null default 0
  check (refunded_amount between 0 and amount_paid);
alter table public.scratch_card_purchases add column refunded_amount numeric(12,2) not null default 0
  check (refunded_amount between 0 and amount);

create view public.scratch_card_history with (security_invoker = true) as
select coalesce(p.id,c.id) as entry_id, p.id as purchase_id, c.id as card_id,
  s.name as student_name, s.admission_no, a.name as session, a.id as session_id,
  coalesce(p.term_code,c.term_code) as term, coalesce(c.source,'online') as source,
  case when c.status='exhausted' then 'active' else c.status end as card_status,
  coalesce(p.status, case when c.source='complimentary' then 'complimentary' else 'received' end) as payment_status,
  coalesce(p.reference,c.payment_reference) as reference, c.serial, c.issued_by_email,
  coalesce(p.created_at,c.created_at) as created_at, coalesce(p.amount,c.amount_paid) as amount,
  case when p.status in ('success','duplicate') then p.amount
       when c.id is not null and c.source <> 'complimentary' then c.amount_paid else 0 end as received,
  coalesce(p.refunded_amount,c.refunded_amount) as refunded
from public.scratch_card_purchases p full join public.scratch_cards c on c.payment_reference=p.reference
join public.students s on s.id=coalesce(p.student_id,c.student_id)
join public.academic_sessions a on a.id=coalesce(p.academic_session_id,c.academic_session_id);

create view public.scratch_card_sales_by_term with (security_invoker = true) as
select session_id, session, term,
  count(*) filter(where source='online' and card_id is not null) as online,
  count(*) filter(where source='offline') as offline,
  count(*) filter(where source='complimentary') as complimentary,
  sum(received) as revenue, sum(refunded) as refunded, sum(received-refunded) as net
from public.scratch_card_history
where card_id is not null or received > 0
group by session_id,session,term;

revoke all on public.scratch_card_history,public.scratch_card_sales_by_term from public,anon,authenticated;
grant select on public.scratch_card_history,public.scratch_card_sales_by_term to service_role;
