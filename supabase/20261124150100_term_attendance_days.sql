-- Older terms may have class-specific totals. Central management starts when an admin saves a total.
alter table public.academic_terms add column if not exists school_days_managed boolean not null default false;

create or replace function public.enforce_term_attendance_days() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare days integer;
begin
  select case when t.school_days_managed then t.school_days end into days
  from public.academic_terms t join public.student_enrollments e on e.academic_session_id=t.academic_session_id
  where e.id=new.enrollment_id and t.term_code=new.term for share of t;
  if days is not null then
    if new.times_present > days then raise exception 'Recorded days present exceed the term total. Review attendance before reducing school days.'; end if;
    new.times_opened := days;
    new.times_absent := days - new.times_present;
  end if;
  return new;
end $$;
revoke all on function public.enforce_term_attendance_days() from public, anon, authenticated;
drop trigger if exists enforce_term_attendance_days on public.attendance_summaries;
create trigger enforce_term_attendance_days before insert or update on public.attendance_summaries
for each row execute function public.enforce_term_attendance_days();

create or replace function public.set_current_school_days(p_session text,p_term public.term_code_enum,p_days integer)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare session_id uuid;
begin
  if p_days is null or p_days not between 1 and 250 then raise exception 'Enter 1 to 250 whole school days.'; end if;
  select current_session_id into session_id from public.app_settings
  where current_session=p_session and current_term=p_term for share;
  if session_id is null then raise exception 'The current term changed. Reload Academic Setup.'; end if;
  insert into public.academic_terms(academic_session_id,term_code,school_days,school_days_managed)
  values(session_id,p_term,p_days,true)
  on conflict (academic_session_id,term_code) do update set school_days=excluded.school_days,school_days_managed=true;
  update public.attendance_summaries a set times_opened=p_days,times_absent=p_days-a.times_present,updated_at=now()
  from public.student_enrollments e where e.id=a.enrollment_id and e.academic_session_id=session_id
    and a.term=p_term and (a.times_opened<>p_days or a.times_absent<>p_days-a.times_present);
end $$;
revoke all on function public.set_current_school_days(text,public.term_code_enum,integer) from public,anon,authenticated;
grant execute on function public.set_current_school_days(text,public.term_code_enum,integer) to service_role;
