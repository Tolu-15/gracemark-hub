begin;
-- Each call is one transaction. A version captured before report construction rejects stale scores.
create or replace function public.publication_version(p_class uuid,p_session text,p_term public.term_code_enum)
returns text language sql stable set search_path=public,pg_temp as $$
 select md5(concat_ws('|',
   (select string_agg(s.id::text,',' order by s.id) from students s where class_id=p_class),
   (select string_agg(r.id::text||':'||r.xmin::text,',' order by r.id) from results r
    where r.session=p_session and r.term=p_term and r.student_id in (select id from students where class_id=p_class)),
   (select string_agg(o.student_id::text||o.subject_id::text,',' order by o.student_id,o.subject_id)
    from student_subject_optouts o join students s on s.id=o.student_id where s.class_id=p_class and o.session=p_session)))
$$;

create or replace function public.commit_publication(p_class uuid,p_session text,p_term public.term_code_enum,p_type public.report_type_enum,
 p_actor uuid,p_version text,p_reports jsonb,p_results uuid[],p_at timestamptz,p_recall boolean)
returns integer language plpgsql set search_path=public,pg_temp as $$
declare sid uuid; col text := lower(p_type::text)||'_status'; affected int;
begin
 lock table students,results,student_subject_optouts,student_enrollments,result_snapshots in share row exclusive mode;
 select id into strict sid from academic_sessions where name=p_session;
 if not exists(select 1 from app_settings where current_session=p_session) then raise exception 'School session changed.'; end if;
 if not p_recall then
   if p_version is distinct from publication_version(p_class,p_session,p_term) then raise exception 'Scores or roster changed. Refresh before publishing.'; end if;
   if jsonb_array_length(p_reports)=0 or exists(select 1 from jsonb_array_elements(p_reports) j
     where not exists(select 1 from students where id=(j#>>'{student,id}')::uuid and class_id=p_class))
     then raise exception 'Report roster changed.'; end if;
   if (select count(*) from results r join students s on s.id=r.student_id where r.id=any(p_results) and r.term=p_term and r.session=p_session and s.class_id=p_class and r.status='approved') <> cardinality(p_results)
     then raise exception 'Approval changed.'; end if;
   if exists(select 1 from jsonb_array_elements(p_reports) j join student_enrollments e
     on e.student_id=(j#>>'{student,id}')::uuid and e.academic_session_id=sid where e.class_id<>p_class) then
     raise exception 'Selected class differs from the session enrollment.'; end if;
   insert into student_enrollments(student_id,class_id,academic_session_id,status)
    select (j#>>'{student,id}')::uuid,p_class,sid,'active' from jsonb_array_elements(p_reports) j
    on conflict(student_id,academic_session_id) do nothing;
 end if;
 delete from result_snapshots x using student_enrollments e,students s where x.enrollment_id=e.id and e.student_id=s.id and e.class_id=p_class and e.academic_session_id=sid
   and x.term=p_term and x.report_type=p_type and (p_recall or not exists(select 1 from jsonb_array_elements(p_reports) j where (j#>>'{student,id}')::uuid=s.id));
 execute format('update results r set %I=''draft'' from students s where r.student_id=s.id and coalesce(r.class_id,s.class_id)=$1 and r.session=$2 and r.term=$3 and r.%I<>''draft''',col,col) using p_class,p_session,p_term;
 if p_recall then return 0; end if;
 insert into result_snapshots(enrollment_id,term,report_type,snapshot_data,published_by,published_at)
   select e.id,p_term,p_type,j,p_actor,p_at from jsonb_array_elements(p_reports) j join student_enrollments e on e.student_id=(j#>>'{student,id}')::uuid and e.academic_session_id=sid
   on conflict(enrollment_id,term,report_type) do update set snapshot_data=excluded.snapshot_data,published_by=excluded.published_by,published_at=excluded.published_at;
 get diagnostics affected=row_count;
 execute format('update results set %I=''published'',published_at=$1 where id=any($2)',col) using p_at,p_results;
 return affected;
end $$;

create or replace function public.set_subject_optout(p_student uuid,p_subject uuid,p_class uuid,p_session text,p_drop boolean,p_actor uuid)
returns void language plpgsql set search_path=public,pg_temp as $$
declare sid uuid; cfg app_settings;
begin
 lock table students,results,student_subject_optouts,student_enrollments in share row exclusive mode;
 select * into strict cfg from app_settings limit 1;
 select id into strict sid from academic_sessions where name=p_session;
 if not (case when cfg.current_session=p_session then exists(select 1 from students where id=p_student and class_id=p_class)
 else exists(select 1 from student_enrollments where student_id=p_student and class_id=p_class and academic_session_id=sid) end)
 then raise exception 'Roster changed.'; end if;
 if p_drop then
  if exists(select 1 from results r where r.student_id=p_student and r.subject_id=p_subject and r.session=p_session and
   ('published' in(r.pr1_status,r.pr2_status,r.pr3_status,r.tr_status) or not ((cfg.current_session=p_session and cfg.current_term=r.term) or exists(
   select 1 from academic_terms a where a.academic_session_id=sid and a.term_code=r.term and a.allow_teacher_edit)))) then raise exception 'Recall or unlock the affected results first.'; end if;
  delete from results where student_id=p_student and subject_id=p_subject and session=p_session;
  insert into student_subject_optouts(student_id,subject_id,session,created_by) values(p_student,p_subject,p_session,p_actor) on conflict(student_id,subject_id,session) do nothing;
 else delete from student_subject_optouts where student_id=p_student and subject_id=p_subject and session=p_session; end if;
end $$;

create or replace function public.commit_promotions(p_source uuid,p_source_name text,p_dest uuid,p_dest_name text,p_items jsonb,p_actor uuid,p_notes text)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare src academic_sessions; dst academic_sessions; item jsonb; pupil students; origin classes; dest classes; decision text; act text;
 summary jsonb:='[]'; skipped jsonb:='[]'; pid uuid; src_enrollment uuid; affected_optouts uuid[];
begin
 lock table students,results,student_subject_optouts,student_enrollments,result_snapshots,promotions in share row exclusive mode;
 select * into strict src from academic_sessions where case when p_source is null then name=p_source_name else id=p_source end;
 if p_dest is null and nullif(p_dest_name,'') is not null then
   insert into academic_sessions(name,status,is_current) values(p_dest_name,'active',false) on conflict(name) do nothing;
 end if;
 select * into strict dst from academic_sessions where case when p_dest is null then name=p_dest_name else id=p_dest end;
 if src.id=dst.id then raise exception 'Select different sessions.'; end if;
 if jsonb_array_length(p_items)=0 or (select count(distinct j->>'studentId') from jsonb_array_elements(p_items) j)<>jsonb_array_length(p_items) then raise exception 'Invalid or duplicate students.'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select * into strict pupil from students where id=(item->>'studentId')::uuid;
  select * into strict origin from classes where id=(item->>'fromClassId')::uuid;
  select id into src_enrollment from student_enrollments where student_id=pupil.id and academic_session_id=src.id and class_id=origin.id and status='active';
  if src_enrollment is null and pupil.class_id=origin.id and pupil.is_alumni is not true
     and exists(select 1 from app_settings where current_session=src.name)
     and not exists(select 1 from student_enrollments where student_id=pupil.id and academic_session_id=src.id) then
   insert into student_enrollments(student_id,class_id,academic_session_id,status)
    values(pupil.id,origin.id,src.id,'active') returning id into src_enrollment;
  end if;
  if src_enrollment is null or pupil.is_alumni is true or coalesce(pupil.current_class_id,pupil.class_id) is distinct from origin.id then raise exception 'Source enrollment or class has changed.'; end if;
  act:=coalesce(item->>'action','promote');
  if act not in ('promote','graduate','repeat') then raise exception 'Unknown action.'; end if;
  select snapshot_data#>>'{promotion,status}' into decision from result_snapshots where enrollment_id=src_enrollment and term='term3' and report_type='TR';
  if (item->'override') is distinct from 'true'::jsonb then
   if decision is null then skipped:=skipped||jsonb_build_object('name',pupil.name,'reason','3rd-term result not published'); continue; end if;
   if decision='REPEAT' then act:='repeat'; end if;
  end if;
  if exists(select 1 from student_enrollments where student_id=pupil.id and academic_session_id=dst.id) then raise exception 'Destination enrollment already exists.'; end if;
  affected_optouts:='{}';
  if act='graduate' then
   update students set is_alumni=true where id=pupil.id;
   update student_enrollments set status='graduated' where id=src_enrollment;
   dest:=null;
  else
   select * into strict dest from classes where id=case when act='repeat' then origin.id else (item->>'toClassId')::uuid end;
   insert into student_enrollments(student_id,class_id,academic_session_id,status) values(pupil.id,dest.id,dst.id,'active');
   if act='repeat' then
    update student_enrollments set status='repeated' where id=src_enrollment;
   else
    update student_enrollments set status='promoted' where id=src_enrollment;
    update students set current_class_id=dest.id,class_id=dest.id where id=pupil.id;
    with added as (insert into student_subject_optouts(student_id,subject_id,session)
    select pupil.id,o.subject_id,dst.name from student_subject_optouts o join subject_group_subjects g on g.subject_id=o.subject_id
     where o.student_id=pupil.id and o.session=src.name and g.group_code=dest.subject_group_code
     on conflict(student_id,subject_id,session) do nothing returning id)
    select array(select id from added) into affected_optouts;
   end if;
  end if;
  summary:=summary||jsonb_build_object('student_id',pupil.id,'name',pupil.name,'from_class',origin.name,'from_class_id',origin.id,'to_class_id',dest.id,
   'to_class',coalesce(dest.name,'Alumni (Graduated)'),'graduated',act='graduate','action',case act when 'promote' then 'promoted' when 'graduate' then 'graduated' else 'repeat' end,'added_optout_ids',affected_optouts);
 end loop;
 if jsonb_array_length(summary)>0 then
 insert into promotions(from_session_id,to_session_id,promoted_by,summary,notes) values(src.id,dst.id,p_actor,summary,p_notes) returning id into pid;
 end if;
 return jsonb_build_object('summary',summary,'skipped',skipped,'promotionId',pid);
end $$;

revoke all on function public.publication_version(uuid,text,public.term_code_enum),public.commit_publication(uuid,text,public.term_code_enum,public.report_type_enum,uuid,text,jsonb,uuid[],timestamptz,boolean),public.set_subject_optout(uuid,uuid,uuid,text,boolean,uuid),public.commit_promotions(uuid,text,uuid,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.publication_version(uuid,text,public.term_code_enum),public.commit_publication(uuid,text,public.term_code_enum,public.report_type_enum,uuid,text,jsonb,uuid[],timestamptz,boolean),public.set_subject_optout(uuid,uuid,uuid,text,boolean,uuid),public.commit_promotions(uuid,text,uuid,text,jsonb,uuid,text) to service_role;

-- Lock in the same order as promotion execution. Keep legacy history readable by
-- resolving class names when older summary entries do not contain class IDs.
create or replace function public.rollback_promotions(p_id uuid, p_actor uuid)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare
 run promotions; item jsonb; pupil students; origin uuid; target uuid; placement student_enrollments;
 source_row student_enrollments; dest_name text; reason text; dependency record; has_data boolean;
 skipped jsonb := '[]'; restored integer := 0;
begin
 lock table students,results,student_subject_optouts,student_enrollments,result_snapshots,promotions in share row exclusive mode;
 select * into strict run from promotions where id=p_id;
 if run.rolled_back_at is not null or exists(select 1 from promotions where rolled_back_at is null and promoted_at>run.promoted_at) then
  raise exception 'Only the latest outstanding promotion can be rolled back.';
 end if;
 select name into strict dest_name from academic_sessions where id=run.to_session_id;
 for item in select value from jsonb_array_elements(run.summary) loop
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
   skipped:=skipped||jsonb_build_object('name',item->>'name','reason',reason); continue;
  end if;
  if placement.id is not null then
   delete from student_subject_optouts where student_id=pupil.id and session=dest_name and id in
    (select value::uuid from jsonb_array_elements_text(coalesce(item->'added_optout_ids','[]')));
   delete from student_enrollments where id=placement.id;
  end if;
  update student_enrollments set status='active' where id=source_row.id;
  update students set class_id=origin,current_class_id=origin,is_alumni=false where id=pupil.id;
  restored:=restored+1;
 end loop;
 update promotions set rolled_back_at=now(),rolled_back_by=p_actor where id=p_id;
 return jsonb_build_object('restored',restored,'skipped',skipped);
end $$;
revoke all on function public.rollback_promotions(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rollback_promotions(uuid,uuid) to service_role;
commit;
