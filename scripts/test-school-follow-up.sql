-- Run after the academic fixture in a disposable database.
\set ON_ERROR_STOP on
create table users(id uuid primary key);
create table scratch_card_purchases(id uuid primary key,student_id uuid,academic_session_id uuid,term_code term_code_enum,reference text,status text,amount numeric,refunded_amount numeric default 0,created_at timestamptz default now(),updated_at timestamptz default now());
create table scratch_cards(student_id uuid,academic_session_id uuid,term_code term_code_enum,serial text,payment_reference text,created_at timestamptz default now());
create table fee_structures(id uuid primary key,academic_session_id uuid,term term_code_enum);
create table payment_invoices(id uuid primary key,student_id uuid,fee_structure_id uuid,total_amount numeric);
create table payment_transactions(id uuid primary key,invoice_id uuid,payment_reference text,amount numeric,status text,paid_at timestamptz);
\ir ../supabase/051_school_follow_up.sql

do $$
declare student uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid(); fee uuid:=gen_random_uuid();
 invoice uuid:=gen_random_uuid(); extra uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); purchase uuid:=gen_random_uuid();
begin
 insert into students(id,name) values(student,'Fixture pupil');
 insert into academic_sessions(id,name) values(session_id,'Fixture session');
 insert into users values(actor);
 insert into fee_structures values(fee,session_id,'term1');
 insert into payment_invoices values(invoice,student,fee,100);
 insert into payment_transactions values(gen_random_uuid(),invoice,'first',60,'success',now()-interval '2 hours'),
 (gen_random_uuid(),invoice,'second',40,'success',now()-interval '1 hour');
 if exists(select 1 from duplicate_fee_payments) then raise exception 'Installments flagged as duplicates'; end if;
 insert into payment_transactions values(extra,invoice,'extra',40,'success',now());
 if not exists(select 1 from duplicate_fee_payments where id=extra and original_reference='second' and amount=40) then raise exception 'Missing duplicate fee references'; end if;
 insert into fee_payment_resolutions values(extra,40,'refund','Paid to family',actor,now());
 if not exists(select 1 from duplicate_fee_payments where id=extra and resolution='refund') then raise exception 'Fee resolution missing'; end if;
 insert into scratch_cards values(student,session_id,'term1','serial','original',now()-interval '1 hour');
 insert into scratch_card_purchases(id,student_id,academic_session_id,term_code,reference,status,amount)
 values(purchase,student,session_id,'term1','additional','duplicate',1000);
 update scratch_card_purchases set resolution='credit',resolution_note='Credited for next term',resolved_by=actor,resolved_at=now() where id=purchase;
 if not exists(select 1 from duplicate_card_payments where id=purchase and original_reference='original' and resolution='credit') then raise exception 'Duplicate card resolution missing'; end if;
 if has_table_privilege('authenticated','result_corrections','select') or has_table_privilege('authenticated','support_notes','select') then raise exception 'Private case records exposed'; end if;
end $$;
