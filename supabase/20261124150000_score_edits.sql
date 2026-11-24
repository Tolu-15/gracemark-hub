-- Row revisions also change when approvals, imports or another writer updates a result.
alter table public.results add column if not exists score_version uuid not null default gen_random_uuid();

create or replace function public.refresh_score_version() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.score_version = old.score_version then new.score_version := gen_random_uuid(); end if;
  return new;
end $$;
drop trigger if exists refresh_score_version on public.results;
create trigger refresh_score_version before update on public.results
for each row execute function public.refresh_score_version();

create or replace function public.save_score_edits(p_records jsonb, p_class uuid, p_subject uuid,
  p_term public.term_code_enum, p_session text, p_session_id uuid, p_teacher uuid)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  patch record;
begin
  for patch in select * from jsonb_to_recordset(p_records) as e(student_id uuid, expected uuid,
    score_version uuid, clear boolean, status_only boolean, score_breakdown jsonb, cw numeric,
    hw numeric, test numeric, project numeric, exam numeric, grade text, status text) order by student_id
  loop
    if patch.expected is null then
      insert into public.results(student_id, class_id, subject_id, term, session, academic_session_id,
        teacher_id, cw, hw, test, project, exam, grade, score_breakdown, status, score_version)
      select patch.student_id,p_class,p_subject,p_term,p_session,p_session_id,p_teacher,
        patch.cw,patch.hw,patch.test,patch.project,patch.exam,patch.grade,patch.score_breakdown,
        patch.status::public.result_status_enum,patch.score_version
      on conflict (student_id,subject_id,term,session) do nothing;
    elsif patch.clear then
      delete from public.results r where r.student_id=patch.student_id and r.subject_id=p_subject
        and r.term=p_term and r.session=p_session and (r.class_id=p_class or r.class_id is null)
        and r.score_version=patch.expected and r.score_breakdown is not null
        and not ('published'=any(array_remove(array[r.pr1_status::text,r.pr2_status::text,r.pr3_status::text,r.tr_status::text],null)));
    elsif patch.status_only then
      update public.results r set status='submitted',return_reason=null,score_version=patch.score_version,
        updated_at=now() where r.student_id=patch.student_id and r.subject_id=p_subject and r.term=p_term
        and r.session=p_session and (r.class_id=p_class or r.class_id is null) and r.score_version=patch.expected;
    else
      update public.results r set cw=patch.cw,hw=patch.hw,test=patch.test,project=patch.project,
        exam=patch.exam,grade=patch.grade,score_breakdown=patch.score_breakdown,score_version=patch.score_version,
        teacher_id=coalesce(p_teacher,r.teacher_id),class_id=p_class,academic_session_id=p_session_id,
        status=patch.status::public.result_status_enum,
        return_reason=case when patch.status='submitted' then null else r.return_reason end,updated_at=now()
      where r.student_id=patch.student_id and r.subject_id=p_subject and r.term=p_term and r.session=p_session
        and (r.class_id=p_class or r.class_id is null) and r.score_version=patch.expected;
    end if;
    if not found then raise exception 'Score changed. Reload the sheet.'; end if;
  end loop;
end $$;
revoke all on function public.save_score_edits(jsonb,uuid,uuid,public.term_code_enum,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.save_score_edits(jsonb,uuid,uuid,public.term_code_enum,text,uuid,uuid) to service_role;
