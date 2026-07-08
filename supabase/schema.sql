-- Gracemark Academy (Supabase / Postgres) relational schema
-- Apply in Supabase SQL editor (or via migrations).

-- Extensions (usually enabled by default in Supabase)
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Users Table (Matches Supabase Auth)
-- Ensures we have auth_id properly mapped to Supabase auth.users.id
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique not null,
  email text,
  display_name text,
  role text check (role in ('admin', 'teacher', 'student')),
  created_at timestamptz not null default now()
);
create index if not exists users_auth_id_idx on public.users(auth_id);
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
-- ------------------------------------------------------------

-- Term constraint helper
create or replace function public.is_valid_term(term text)
returns boolean
language sql
immutable
as $$
  select term in ('term1', 'term2', 'term3')
$$;

-- ---------- Core tables ----------

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  session text not null,
  created_at timestamptz not null default now()
);

-- classes: create minimal shell first (handles legacy table with only id + name)
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Upgrade legacy classes (no school_id / session / created_at) to current shape
alter table public.classes add column if not exists created_at timestamptz not null default now();
alter table public.classes add column if not exists school_id uuid references public.schools(id) on delete cascade;
alter table public.classes add column if not exists session text;

insert into public.schools (name, session)
select 'Gracemark Academy', ''
where not exists (select 1 from public.schools);

update public.classes c
set
  school_id = coalesce(
    c.school_id,
    (select s.id from public.schools s order by s.created_at asc limit 1)
  ),
  session = coalesce(nullif(c.session, ''), '')
where c.school_id is null or c.session is null;

alter table public.classes alter column school_id set not null;
alter table public.classes alter column session set not null;
alter table public.classes alter column session set default '';

create index if not exists classes_school_id_idx on public.classes(school_id);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  user_id uuid not null, -- auth.users.id (uuid). Stored as plain uuid (no FK).
  admission_no text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (admission_no),
  unique (user_id)
);
create index if not exists students_class_id_idx on public.students(class_id);
create index if not exists students_user_id_idx on public.students(user_id);
create unique index if not exists students_admission_no_unique_idx on public.students(admission_no);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  term text not null check (public.is_valid_term(term)),
  status text not null default 'draft' check (status in ('draft', 'published', 'approved')),
  submitted_by uuid, -- teacher auth uid
  approved_by uuid,  -- admin auth uid
  approved_at timestamptz,
  cw int not null default 0 check (cw between 0 and 100),
  hw int not null default 0 check (hw between 0 and 100),
  test int not null default 0 check (test between 0 and 100),
  project int not null default 0 check (project between 0 and 100),
  exam int not null default 0 check (exam between 0 and 100),
  score_breakdown jsonb,
  total int not null default 0 check (total between 0 and 100),
  grade text not null default 'F',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, subject_id, term)
);
create index if not exists results_student_id_idx on public.results(student_id);
create index if not exists results_subject_id_idx on public.results(subject_id);
create index if not exists results_term_idx on public.results(term);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  term text not null check (public.is_valid_term(term)),
  days_present int not null default 0 check (days_present >= 0),
  days_absent int not null default 0 check (days_absent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, term)
);
create index if not exists attendance_student_id_idx on public.attendance(student_id);

create table if not exists public.class_averages (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  term text not null check (public.is_valid_term(term)),
  avg double precision not null default 0,
  lowest double precision not null default 0,
  highest double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, subject_id, term)
);
create index if not exists class_averages_class_id_idx on public.class_averages(class_id);

-- ---------- Supporting tables (needed for teacher scoping + app settings) ----------

-- Teacher can only access classes/subjects explicitly assigned here.
create table if not exists public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_user_id uuid not null, -- auth.users.id
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (teacher_user_id, class_id, subject_id)
);
create index if not exists teacher_assignments_teacher_user_id_idx on public.teacher_assignments(teacher_user_id);
create index if not exists teacher_assignments_class_id_idx on public.teacher_assignments(class_id);

-- Simple global settings (keeps existing UI working; optional)
create table if not exists public.app_settings (
  id int primary key,
  current_term text not null default 'term1' check (public.is_valid_term(current_term)),
  current_session text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, current_term, current_session)
values (1, 'term1', '')
on conflict (id) do nothing;

grant select on table public.app_settings to authenticated;
grant all on table public.app_settings to service_role;

-- ---------- Triggers: updated_at + total/grade ----------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_results_updated_at on public.results;
create trigger set_results_updated_at
before update on public.results
for each row execute function public.set_updated_at();

drop trigger if exists set_attendance_updated_at on public.attendance;
create trigger set_attendance_updated_at
before update on public.attendance
for each row execute function public.set_updated_at();

drop trigger if exists set_class_averages_updated_at on public.class_averages;
create trigger set_class_averages_updated_at
before update on public.class_averages
for each row execute function public.set_updated_at();

drop trigger if exists set_app_settings_updated_at on public.app_settings;
create trigger set_app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

create or replace function public.grade_from_total(total_score int)
returns text
language plpgsql
immutable
as $$
begin
  if total_score is null then
    return 'F';
  end if;
  if total_score >= 70 then return 'A'; end if;
  if total_score >= 60 then return 'B'; end if;
  if total_score >= 50 then return 'C'; end if;
  if total_score >= 45 then return 'D'; end if;
  if total_score >= 40 then return 'E'; end if;
  return 'F';
end;
$$;

create or replace function public.compute_result_total_and_grade()
returns trigger
language plpgsql
as $$
declare
  computed_total int;
begin
  computed_total :=
    coalesce(new.cw, 0) +
    coalesce(new.hw, 0) +
    coalesce(new.test, 0) +
    coalesce(new.project, 0) +
    coalesce(new.exam, 0);

  -- Clamp to 0..100 (keeps constraints happy even if component scoring changes)
  if computed_total < 0 then computed_total := 0; end if;
  if computed_total > 100 then computed_total := 100; end if;

  new.total := computed_total;
  new.grade := public.grade_from_total(computed_total);
  return new;
end;
$$;

drop trigger if exists compute_results_total_and_grade on public.results;
create trigger compute_results_total_and_grade
before insert or update on public.results
for each row execute function public.compute_result_total_and_grade();
