-- Run with psql in an empty, disposable PostgreSQL database.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
create type term_code_enum as enum ('term1','term2','term3');
create type report_type_enum as enum ('PR1','PR2','PR3','TR');
create table classes(id uuid primary key, name text, subject_group_code text);
create table students(id uuid primary key, name text, class_id uuid, current_class_id uuid, is_alumni boolean default false);
create table academic_sessions(id uuid primary key default gen_random_uuid(), name text unique, status text, is_current boolean);
create table academic_terms(academic_session_id uuid, term_code term_code_enum, allow_teacher_edit boolean);
create table app_settings(current_session text, current_term term_code_enum);
create table student_enrollments(id uuid primary key default gen_random_uuid(), student_id uuid, academic_session_id uuid, class_id uuid, status text, unique(student_id,academic_session_id));
create table result_snapshots(enrollment_id uuid references student_enrollments(id) on delete cascade, term term_code_enum, report_type report_type_enum, snapshot_data jsonb, published_by uuid, published_at timestamptz, unique(enrollment_id,term,report_type));
create table results(id uuid primary key, student_id uuid, class_id uuid, subject_id uuid, session text, term term_code_enum, status text, pr1_status text, pr2_status text, pr3_status text, tr_status text, published_at timestamptz);
create table student_subject_optouts(id uuid primary key default gen_random_uuid(), student_id uuid, subject_id uuid, session text, created_by uuid, unique(student_id,subject_id,session));
create table subject_group_subjects(group_code text, subject_id uuid);
create table promotions(id uuid primary key default gen_random_uuid(), from_session_id uuid,to_session_id uuid,promoted_by uuid,summary jsonb,notes text,promoted_at timestamptz default now(),rolled_back_at timestamptz,rolled_back_by uuid);
\ir ../supabase/047_academic_transactions.sql
\ir ../supabase/050_rollback_outcomes.sql

do $$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); d uuid:=gen_random_uuid();
 pupil uuid:=gen_random_uuid(); subject uuid:=gen_random_uuid(); score uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid();
 item jsonb; report jsonb; version text; run jsonb; undone jsonb; rejected boolean:=false;
begin
 insert into classes values(a,'JSS1','junior'),(b,'JSS2','junior');
 insert into students values(pupil,'Test pupil',a,a,false);
 insert into academic_sessions values(s,'2025/2026','active',true),(d,'2026/2027','active',false);
 insert into app_settings values('2025/2026','term3');
 insert into results(id,student_id,class_id,subject_id,session,term,status,tr_status)
 values(score,pupil,a,subject,'2025/2026','term3','approved','draft');
 report:=jsonb_build_object('student',jsonb_build_object('id',pupil,'className','JSS1'),'promotion',jsonb_build_object('status','PROMOTED'));
 version:=publication_version(a,'2025/2026','term3');
 perform commit_publication(a,'2025/2026','term3','TR',actor,version,jsonb_build_array(report),array[score],now(),false);
 item:=jsonb_build_object('studentId',pupil,'fromClassId',a,'toClassId',b,'action','promote');
 begin
  perform commit_promotions(s,null,d,null,jsonb_build_array(item,item||jsonb_build_object('studentId',gen_random_uuid())),actor,null);
 exception when no_data_found then rejected:=true;
 end;
 if not rejected or exists(select 1 from student_enrollments where academic_session_id=d) or exists(select 1 from promotions) then
  raise exception 'Invalid batch left partial changes'; end if;
 run:=commit_promotions(s,null,d,null,jsonb_build_array(item),actor,null);
 if not exists(select 1 from students where id=pupil and class_id=b and current_class_id=b) or
  not exists(select 1 from student_enrollments e join result_snapshots r on r.enrollment_id=e.id
    where e.student_id=pupil and e.class_id=a and e.academic_session_id=s and r.snapshot_data=report) then
  raise exception 'Promotion lost current or historical placement'; end if;
 insert into results(id,student_id,session) values(gen_random_uuid(),pupil,'2026/2027');
 undone:=rollback_promotions((run->>'promotionId')::uuid,actor);
 if jsonb_array_length(undone->'skipped')<>1 or not exists(select 1 from promotions where id=(run->>'promotionId')::uuid and rolled_back_at is null and rollback_outcomes->pupil::text->>'status'='skipped') then raise exception 'Partial rollback incorrectly recorded'; end if;
 delete from results where student_id=pupil and session='2026/2027';
 undone:=rollback_promotions((run->>'promotionId')::uuid,actor);
 if (undone->>'restored')::integer<>1 or exists(select 1 from student_enrollments where academic_session_id=d)
  or not exists(select 1 from students where id=pupil and class_id=a and current_class_id=a) then raise exception 'Rollback failed'; end if;
 perform commit_publication(a,'2025/2026','term3','TR',actor,null,'[]','{}',now(),true);
 if exists(select 1 from result_snapshots) then raise exception 'Recall left published snapshots'; end if;
 perform set_subject_optout(pupil,subject,a,'2025/2026',true,actor);
 if exists(select 1 from results) or not exists(select 1 from student_subject_optouts) then raise exception 'Opt-out failed'; end if;
 run:=commit_promotions(s,null,d,null,jsonb_build_array(item||'{"action":"repeat","override":true}'::jsonb),actor,null);
 if not exists(select 1 from student_enrollments where student_id=pupil and academic_session_id=d and class_id=a and status='active')
   or not exists(select 1 from student_enrollments where student_id=pupil and academic_session_id=s and status='repeated') then
  raise exception 'Repeat did not retain the original class in the next session'; end if;
 undone:=rollback_promotions((run->>'promotionId')::uuid,actor);
 if (undone->>'restored')::integer<>1 then raise exception 'Repeat rollback failed'; end if;
 run:=commit_promotions(s,null,d,null,jsonb_build_array(item||'{"action":"graduate","override":true}'::jsonb),actor,null);
 if not exists(select 1 from students where id=pupil and is_alumni)
   or not exists(select 1 from student_enrollments where student_id=pupil and academic_session_id=s and status='graduated')
   or exists(select 1 from student_enrollments where student_id=pupil and academic_session_id=d) then
  raise exception 'Graduation changed the wrong placement'; end if;
 undone:=rollback_promotions((run->>'promotionId')::uuid,actor);
 if (undone->>'restored')::integer<>1 or not exists(select 1 from students where id=pupil and is_alumni=false)
   or not exists(select 1 from student_enrollments where student_id=pupil and academic_session_id=s and status='active') then
  raise exception 'Graduation rollback failed'; end if;
end $$;
