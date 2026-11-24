begin;
alter table public.promotions add column rollback_outcomes jsonb not null default '{}';
create or replace function public.rollback_promotions(p_id uuid, p_actor uuid)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare
 run promotions; item jsonb; pupil students; origin uuid; target uuid; placement student_enrollments;
 source_row student_enrollments; dest_name text; reason text; dependency record; has_data boolean;
 outcomes jsonb; skipped jsonb := '[]'; restored integer := 0;
begin
 lock table students,results,student_subject_optouts,student_enrollments,result_snapshots,promotions in share row exclusive mode;
 select * into strict run from promotions where id=p_id;
 if run.rolled_back_at is not null or exists(select 1 from promotions where rolled_back_at is null and promoted_at>run.promoted_at) then
  raise exception 'Only the latest outstanding promotion can be rolled back.';
 end if;
 select name into strict dest_name from academic_sessions where id=run.to_session_id;
 outcomes:=run.rollback_outcomes;
 for item in select value from jsonb_array_elements(run.summary) loop
  if outcomes->(item->>'student_id')->>'status'='restored' then continue; end if;
  reason:=null;
  select * into pupil from students where id=(item->>'student_id')::uuid;
  select id into origin from classes where id=(item->>'from_class_id')::uuid or
    (item->>'from_class_id' is null and upper(trim(name))=upper(trim(item->>'from_class')));
  select id into target from classes where id=(item->>'to_class_id')::uuid or
    (item->>'to_class_id' is null and upper(trim(name))=upper(trim(item->>'to_class')));
  select * into source_row from student_enrollments where student_id=pupil.id and academic_session_id=run.from_session_id;
  select * into placement from student_enrollments where student_id=pupil.id and academic_session_id=run.to_session_id for update;
  if pupil.id is null or source_row.id is null or origin is null or source_row.class_id<>origin or run.from_session_id=run.to_session_id then
   reason:='Original enrollment needs manual review';
  elsif item->>'action'='graduated' then
   if pupil.is_alumni is not true or placement.id is not null or source_row.status<>'graduated' then reason:='Graduation status has changed'; end if;
  elsif item->>'action' in ('promoted','repeat') then
   if placement.id is null or placement.status<>'active' or target is null or placement.class_id<>target
     or coalesce(pupil.current_class_id,pupil.class_id) is distinct from target or pupil.is_alumni is true then
    reason:='Destination placement has changed';
   elsif exists(select 1 from results where student_id=pupil.id and session=dest_name) then
    reason:='Already has results in '||dest_name;
   else
    -- Check even cascading foreign keys so a rollback cannot discard dependent records.
    for dependency in select c.conrelid::regclass as rel, a.attname as col from pg_constraint c
     join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
     where c.contype='f' and c.confrelid='public.student_enrollments'::regclass and cardinality(c.conkey)=1 loop
     execute format('select exists(select 1 from %s where %I=$1)',dependency.rel,dependency.col) into has_data using placement.id;
     if has_data then reason:='Destination enrollment already has records'; exit; end if;
    end loop;
   end if;
  else reason:='Unknown historical action';
  end if;
  if reason is not null then
   outcomes:=outcomes||jsonb_build_object(item->>'student_id',jsonb_build_object('status','skipped','name',item->>'name','reason',reason));
   skipped:=skipped||jsonb_build_object('name',item->>'name','reason',reason); continue;
  end if;
  if placement.id is not null then
   delete from student_subject_optouts where student_id=pupil.id and session=dest_name and id in
    (select value::uuid from jsonb_array_elements_text(coalesce(item->'added_optout_ids','[]')));
   delete from student_enrollments where id=placement.id;
  end if;
  update student_enrollments set status='active' where id=source_row.id;
  update students set class_id=origin,current_class_id=origin,is_alumni=false where id=pupil.id;
  outcomes:=outcomes||jsonb_build_object(item->>'student_id',jsonb_build_object('status','restored','name',item->>'name'));
  restored:=restored+1;
 end loop;
 update promotions set rollback_outcomes=outcomes,rolled_back_at=case when skipped='[]'::jsonb then now() end,rolled_back_by=p_actor where id=p_id;
 return jsonb_build_object('restored',restored,'skipped',skipped);
end $$;
revoke all on function public.rollback_promotions(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rollback_promotions(uuid,uuid) to service_role;
commit;
