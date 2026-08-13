-- Gracemark Academy merged Supabase schema
-- Generated 2026-08-08.
-- Run this full file in Supabase SQL Editor for a fresh or existing project.
-- The older school_finance_admissions.sql and payment_rpc.sql files are superseded
-- by the final authoritative finance/payment normalization section in this file.


-- ============================================================
-- Source: supabase\schema.sql
-- ============================================================

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


-- ============================================================
-- Source: supabase\rls.sql
-- ============================================================

-- Gracemark Academy RLS policies
-- Run AFTER `supabase/schema.sql`.

-- Helper: current role from public.users (auth_id = auth.uid()).
-- If you store roles differently, update this function + policies.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.users u
  where u.auth_id = auth.uid()
  limit 1
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'admin'
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'teacher'
$$;

create or replace function public.is_student()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'student'
$$;

-- Helper: student row id for current auth user (or null)
create or replace function public.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.students s
  where s.user_id = auth.uid()
  limit 1
$$;

-- Helper: can teacher access a class+subject pair?
create or replace function public.teacher_has_assignment(class_id uuid, subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.teacher_user_id = auth.uid()
      and ta.class_id = teacher_has_assignment.class_id
      and ta.subject_id = teacher_has_assignment.subject_id
  )
$$;

-- Helper: can teacher access a class (any subject)?
create or replace function public.teacher_has_class(class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.teacher_user_id = auth.uid()
      and ta.class_id = teacher_has_class.class_id
  )
$$;

-- Enable RLS everywhere
alter table public.schools enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.subjects enable row level security;
alter table public.results enable row level security;
alter table public.attendance enable row level security;
alter table public.class_averages enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.app_settings enable row level security;

-- ---------------- Schools ----------------
drop policy if exists schools_admin_all on public.schools;
create policy schools_admin_all on public.schools
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists schools_read_authenticated on public.schools;
create policy schools_read_authenticated on public.schools
for select
using (auth.role() = 'authenticated');

-- ---------------- Classes ----------------
drop policy if exists classes_admin_all on public.classes;
create policy classes_admin_all on public.classes
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists classes_teacher_read on public.classes;
create policy classes_teacher_read on public.classes
for select
using (public.is_teacher() and public.teacher_has_class(id));

drop policy if exists classes_student_read on public.classes;
create policy classes_student_read on public.classes
for select
using (
  public.is_student()
  and id = (select s.class_id from public.students s where s.user_id = auth.uid() limit 1)
);

-- ---------------- Subjects ----------------
drop policy if exists subjects_admin_all on public.subjects;
create policy subjects_admin_all on public.subjects
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists subjects_read_authenticated on public.subjects;
create policy subjects_read_authenticated on public.subjects
for select
using (auth.role() = 'authenticated');

-- ---------------- Students ----------------
drop policy if exists students_admin_all on public.students;
create policy students_admin_all on public.students
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists students_teacher_read on public.students;
create policy students_teacher_read on public.students
for select
using (public.is_teacher() and public.teacher_has_class(class_id));

drop policy if exists students_student_read_own on public.students;
create policy students_student_read_own on public.students
for select
using (public.is_student() and user_id = auth.uid());

-- ---------------- Teacher assignments ----------------
drop policy if exists teacher_assignments_admin_all on public.teacher_assignments;
create policy teacher_assignments_admin_all on public.teacher_assignments
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists teacher_assignments_teacher_read on public.teacher_assignments;
create policy teacher_assignments_teacher_read on public.teacher_assignments
for select
using (public.is_teacher() and teacher_user_id = auth.uid());

-- ---------------- Results ----------------
drop policy if exists results_admin_all on public.results;
create policy results_admin_all on public.results
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists results_student_read_own on public.results;
create policy results_student_read_own on public.results
for select
using (public.is_student() and status = 'approved' and student_id = public.current_student_id());

drop policy if exists results_teacher_read on public.results;
create policy results_teacher_read on public.results
for select
using (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = results.student_id
      and public.teacher_has_assignment(s.class_id, results.subject_id)
  )
);

drop policy if exists results_teacher_write on public.results;
create policy results_teacher_write on public.results
for insert
with check (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = results.student_id
      and public.teacher_has_assignment(s.class_id, results.subject_id)
  )
  and results.submitted_by = auth.uid()
  and results.status in ('draft', 'published')
);

drop policy if exists results_teacher_update on public.results;
create policy results_teacher_update on public.results
for update
using (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = results.student_id
      and public.teacher_has_assignment(s.class_id, results.subject_id)
  )
  and results.submitted_by = auth.uid()
  and results.status in ('draft', 'published', 'approved')
)
with check (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = results.student_id
      and public.teacher_has_assignment(s.class_id, results.subject_id)
  )
  and results.submitted_by = auth.uid()
  and results.status in ('draft', 'published')
);

-- ---------------- Attendance ----------------
drop policy if exists attendance_admin_all on public.attendance;
create policy attendance_admin_all on public.attendance
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists attendance_student_read_own on public.attendance;
create policy attendance_student_read_own on public.attendance
for select
using (public.is_student() and student_id = public.current_student_id());

drop policy if exists attendance_teacher_all_for_class on public.attendance;
create policy attendance_teacher_all_for_class on public.attendance
for all
using (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = attendance.student_id
      and public.teacher_has_class(s.class_id)
  )
)
with check (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = attendance.student_id
      and public.teacher_has_class(s.class_id)
  )
);

-- ---------------- Class averages ----------------
drop policy if exists class_averages_admin_all on public.class_averages;
create policy class_averages_admin_all on public.class_averages
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists class_averages_teacher_read on public.class_averages;
create policy class_averages_teacher_read on public.class_averages
for select
using (public.is_teacher() and public.teacher_has_assignment(class_id, subject_id));

drop policy if exists class_averages_student_read on public.class_averages;
create policy class_averages_student_read on public.class_averages
for select
using (
  public.is_student()
  and class_id = (select s.class_id from public.students s where s.user_id = auth.uid() limit 1)
);

-- ---------------- App settings ----------------
drop policy if exists app_settings_admin_all on public.app_settings;
create policy app_settings_admin_all on public.app_settings
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists app_settings_read_authenticated on public.app_settings;
create policy app_settings_read_authenticated on public.app_settings
for select
to authenticated
using (true);

-- Table grants (fixes "permission denied for table app_settings" when RLS is enabled)
grant select on table public.app_settings to authenticated;
grant all on table public.app_settings to service_role;


-- ============================================================
-- Source: supabase\patch_existing.sql
-- ============================================================

-- Apply this if you already ran `supabase/schema.sql` before workflow columns existed,
-- or if `classes` was created from an older script without school_id.

-- ---------- Legacy classes â†’ current schema ----------
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  session text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

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

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes' and column_name = 'school_id'
  ) then
    execute 'alter table public.classes alter column school_id set not null';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes' and column_name = 'session'
  ) then
    execute 'alter table public.classes alter column session set not null';
    execute 'alter table public.classes alter column session set default ''''';
  end if;
exception
  when others then
    raise notice 'classes NOT NULL migration skipped: %', sqlerrm;
end $$;

create index if not exists classes_school_id_idx on public.classes(school_id);

-- Ensure app can read/write public.users (fixes login loop when RLS was turned on)
alter table public.users disable row level security;
grant select, insert, update, delete on table public.users to authenticated;
grant all on table public.users to service_role;

-- Raw score lines for teacher entry (5 CW, 5 HW, 3 tests, project, exam)
alter table public.results add column if not exists score_breakdown jsonb;

-- ---------- Existing patch (users, results workflow) ----------

do $$
begin
  -- Add optional email column to users profile table (if your app uses it)
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'users') then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'users' and column_name = 'email'
    ) then
      execute 'alter table public.users add column email text';
    end if;
  end if;
end $$;

-- Ensure `public.users(auth_id)` has a unique constraint (required for `.upsert(..., { onConflict: "auth_id" })`)
do $$
declare
  auth_id_attnum int;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'users') then
    return;
  end if;

  select attnum
  into auth_id_attnum
  from pg_attribute
  where attrelid = 'public.users'::regclass
    and attname = 'auth_id'
    and not attisdropped;

  if auth_id_attnum is null then
    raise notice 'Skipping users auth_id uniqueness: column public.users.auth_id not found';
    return;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and contype in ('u', 'p')
      and conkey = array[auth_id_attnum]
  ) then
    execute 'alter table public.users add constraint users_auth_id_unique unique (auth_id)';
  end if;
end $$;

alter table public.results
  add column if not exists status text not null default 'draft',
  add column if not exists submitted_by uuid,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'results_status_check'
  ) then
    execute $sql$alter table public.results
      add constraint results_status_check
      check (status in ('draft','published','approved'))$sql$;
  end if;
exception
  when duplicate_object then null;
end $$;

create index if not exists results_status_idx on public.results(status);

-- App settings: allow signed-in teachers/students/admins to read current term/session
grant select on table public.app_settings to authenticated;
grant all on table public.app_settings to service_role;

drop policy if exists app_settings_read_authenticated on public.app_settings;
create policy app_settings_read_authenticated on public.app_settings
for select
to authenticated
using (true);

-- Allow teachers to re-submit previously approved results for admin review
drop policy if exists results_teacher_update on public.results;
create policy results_teacher_update on public.results
for update
using (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = results.student_id
      and public.teacher_has_assignment(s.class_id, results.subject_id)
  )
  and results.submitted_by = auth.uid()
  and results.status in ('draft', 'published', 'approved')
)
with check (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = results.student_id
      and public.teacher_has_assignment(s.class_id, results.subject_id)
  )
  and results.submitted_by = auth.uid()
  and results.status in ('draft', 'published')
);


-- ============================================================
-- Source: supabase\payment_admissions.sql
-- ============================================================

-- Migration: Payment Gateway & Online Admissions Schema
-- Apply in Supabase SQL editor.

-- â”€â”€â”€ 1. Fee Structures Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  academic_session text not null, -- e.g., '2024/2025'
  tuition_amount numeric(10, 2) not null default 0.00,
  registration_fee numeric(10, 2) not null default 0.00,
  exams_fee numeric(10, 2) not null default 0.00,
  facilities_fee numeric(10, 2) not null default 0.00,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, class_id, academic_session)
);

create index if not exists fee_structures_class_id_idx on public.fee_structures(class_id);

-- â”€â”€â”€ 2. Payment Invoices Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists public.payment_invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  fee_structure_id uuid references public.fee_structures(id) on delete set null,
  total_amount numeric(10, 2) not null default 0.00,
  amount_paid numeric(10, 2) not null default 0.00,
  status text not null default 'draft' check (status in ('draft', 'issued', 'partially_paid', 'paid', 'overdue')),
  due_date date,
  issued_date timestamptz not null default now(),
  invoice_number text unique not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_invoices_student_id_idx on public.payment_invoices(student_id);
create index if not exists payment_invoices_invoice_number_idx on public.payment_invoices(invoice_number);

-- â”€â”€â”€ 3. Payment Records Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.payment_invoices(id) on delete cascade,
  payment_reference text unique not null, -- Paystack / Flutterwave reference
  amount numeric(10, 2) not null default 0.00,
  payment_gateway text check (payment_gateway in ('paystack', 'flutterwave', 'manual')),
  gateway_response jsonb,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'cancelled')),
  payment_date timestamptz,
  verified_at timestamptz,
  verified_by uuid references public.users(auth_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_records_invoice_id_idx on public.payment_records(invoice_id);
create index if not exists payment_records_reference_idx on public.payment_records(payment_reference);

-- â”€â”€â”€ 4. Payment Gateway Configuration Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists public.payment_config (
  id uuid primary key default gen_random_uuid(),
  school_id uuid unique not null references public.schools(id) on delete cascade,
  gateway_type text check (gateway_type in ('paystack', 'flutterwave')) default 'paystack',
  public_key text not null,
  secret_key text not null,
  webhook_secret text,
  is_live boolean default false,
  enabled boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- â”€â”€â”€ 5. Admissions Application Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists public.admissions (
  id uuid primary key default gen_random_uuid(),
  admission_number text unique,
  surname text not null,
  first_names text not null,
  date_of_birth date,
  gender text check (gender in ('M', 'F')),
  nationality text default 'Nigerian',
  state_of_origin text,
  religion text,
  home_address text,
  city text,
  state text,
  country text default 'Nigeria',
  passport_photo_url text,
  
  -- Education History
  previous_school_name text,
  previous_school_address text,
  previous_class text,
  
  -- Parent / Guardian Info
  parent_guardian_name text not null,
  parent_guardian_email text,
  parent_guardian_phone text not null,
  parent_guardian_address text,
  parent_guardian_occupation text,
  parent_guardian_religion text,
  
  -- Medical / Boarding Info
  is_boarding boolean default false,
  boarding_type text check (boarding_type in ('full', 'weekday')),
  dietary_requirements text,
  medical_conditions text,
  allergies text,
  
  -- Application Info
  desired_class text not null,
  special_skills text,
  referral_source text check (referral_source in ('teacher', 'student', 'electronic_media', 'handbill', 'social_media', 'parent', 'other')),
  referral_other text,
  
  -- Tracking & Status
  application_status text not null default 'draft' check (application_status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'enrolled')),
  invoice_id uuid references public.payment_invoices(id) on delete set null,
  created_student_id uuid references public.students(id) on delete set null,
  reviewed_by uuid references public.users(auth_id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admissions_status_idx on public.admissions(application_status);
create index if not exists admissions_number_idx on public.admissions(admission_number);

-- â”€â”€â”€ 6. Admissions Audit Trail Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists public.admissions_audit (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id) on delete cascade,
  action text not null, -- 'submitted', 'approved', 'payment_received', 'account_created'
  performed_by uuid references public.users(auth_id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- â”€â”€â”€ Triggers for updated_at â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
drop trigger if exists set_fee_structures_updated_at on public.fee_structures;
create trigger set_fee_structures_updated_at before update on public.fee_structures for each row execute function public.set_updated_at();

drop trigger if exists set_payment_invoices_updated_at on public.payment_invoices;
create trigger set_payment_invoices_updated_at before update on public.payment_invoices for each row execute function public.set_updated_at();

drop trigger if exists set_payment_records_updated_at on public.payment_records;
create trigger set_payment_records_updated_at before update on public.payment_records for each row execute function public.set_updated_at();

drop trigger if exists set_payment_config_updated_at on public.payment_config;
create trigger set_payment_config_updated_at before update on public.payment_config for each row execute function public.set_updated_at();

drop trigger if exists set_admissions_updated_at on public.admissions;
create trigger set_admissions_updated_at before update on public.admissions for each row execute function public.set_updated_at();

-- â”€â”€â”€ Row Level Security (RLS) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
alter table public.fee_structures enable row level security;
alter table public.payment_invoices enable row level security;
alter table public.payment_records enable row level security;
alter table public.payment_config enable row level security;
alter table public.admissions enable row level security;
alter table public.admissions_audit enable row level security;

-- Admin policies (Full access)
drop policy if exists fee_structures_admin_all on public.fee_structures;
create policy fee_structures_admin_all on public.fee_structures for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payment_invoices_admin_all on public.payment_invoices;
create policy payment_invoices_admin_all on public.payment_invoices for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payment_records_admin_all on public.payment_records;
create policy payment_records_admin_all on public.payment_records for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payment_config_admin_all on public.payment_config;
create policy payment_config_admin_all on public.payment_config for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists admissions_admin_all on public.admissions;
create policy admissions_admin_all on public.admissions for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists admissions_audit_admin_all on public.admissions_audit;
create policy admissions_audit_admin_all on public.admissions_audit for all using (public.is_admin()) with check (public.is_admin());

-- Anonymous / Public policy for online admissions application form submission
drop policy if exists admissions_anon_insert on public.admissions;
create policy admissions_anon_insert on public.admissions for insert with check (true);

drop policy if exists admissions_anon_select on public.admissions;
create policy admissions_anon_select on public.admissions for select using (true);

-- Student policies for own invoices
drop policy if exists payment_invoices_student_read on public.payment_invoices;
create policy payment_invoices_student_read on public.payment_invoices for select using (
  public.is_student() and student_id = public.current_student_id()
);

-- Grants
grant all on table public.fee_structures to authenticated, service_role;
grant all on table public.payment_invoices to authenticated, service_role;
grant all on table public.payment_records to authenticated, service_role;
grant all on table public.payment_config to authenticated, service_role;
grant all on table public.admissions to anon, authenticated, service_role;
grant all on table public.admissions_audit to authenticated, service_role;


-- ============================================================
-- Source: supabase\quiz_module.sql
-- ============================================================

-- Migration: Online Quiz & Examination Module
-- Apply in Supabase SQL editor or via database migration pipeline.

-- 1. Create Tables

-- assessments Table
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.users(auth_id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete cascade,
  session text not null,
  term text not null check (public.is_valid_term(term)),
  title text not null,
  description text,
  assessment_type text not null check (assessment_type in ('Test 1 (Week 3)', 'Test 2 (Week 6)', 'Test 3 (Week 9)', 'Term Exam', 'Practice Questions')),
  duration int not null check (duration > 0), -- duration in minutes
  total_marks numeric not null default 0 check (total_marks >= 0),
  pass_mark numeric not null default 0 check (pass_mark >= 0),
  instructions text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  allow_result_view boolean not null default true,
  start_date timestamptz,
  end_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- assessment_questions Table
create table if not exists public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question text not null,
  question_type text not null check (question_type in ('Multiple Choice', 'True / False', 'Fill in the Blank', 'Short Answer', 'Essay')),
  options jsonb, -- array of options for MCQ/TF, null for others
  correct_answer text, -- store string representing correct answer
  explanation text,
  marks numeric not null default 1 check (marks > 0),
  position int not null default 0 check (position >= 0)
);

-- assessment_submissions Table
create table if not exists public.assessment_submissions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  total_score numeric, -- remains null or is set to calculated score
  percentage numeric check (percentage between 0 and 100),
  status text not null default 'started' check (status in ('started', 'submitted', 'graded')),
  time_taken int, -- time taken in seconds
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- assessment_answers Table
create table if not exists public.assessment_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.assessment_submissions(id) on delete cascade,
  question_id uuid not null references public.assessment_questions(id) on delete cascade,
  student_answer text,
  awarded_marks numeric check (awarded_marks >= 0),
  is_correct boolean,
  teacher_feedback text,
  unique (submission_id, question_id)
);

-- uploaded_scores Table
create table if not exists public.uploaded_scores (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.users(auth_id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete set null,
  student_id uuid not null references public.students(id) on delete cascade,
  score numeric not null check (score >= 0),
  remarks text,
  uploaded_at timestamptz not null default now()
);

-- 2. Indexes for Performance and Foreign Keys
create index if not exists assessments_teacher_id_idx on public.assessments(teacher_id);
create index if not exists assessments_subject_id_idx on public.assessments(subject_id);
create index if not exists assessments_class_id_idx on public.assessments(class_id);
create index if not exists assessments_status_idx on public.assessments(status);

create index if not exists assessment_questions_assessment_id_idx on public.assessment_questions(assessment_id);
create index if not exists assessment_questions_position_idx on public.assessment_questions(position);

create index if not exists assessment_submissions_assessment_id_idx on public.assessment_submissions(assessment_id);
create index if not exists assessment_submissions_student_id_idx on public.assessment_submissions(student_id);
create index if not exists assessment_submissions_status_idx on public.assessment_submissions(status);

create index if not exists assessment_answers_submission_id_idx on public.assessment_answers(submission_id);
create index if not exists assessment_answers_question_id_idx on public.assessment_answers(question_id);

create index if not exists uploaded_scores_teacher_id_idx on public.uploaded_scores(teacher_id);
create index if not exists uploaded_scores_student_id_idx on public.uploaded_scores(student_id);
create index if not exists uploaded_scores_assessment_id_idx on public.uploaded_scores(assessment_id);

-- 3. Triggers for updated_at
drop trigger if exists set_assessments_updated_at on public.assessments;
create trigger set_assessments_updated_at
before update on public.assessments
for each row execute function public.set_updated_at();

drop trigger if exists set_assessment_submissions_updated_at on public.assessment_submissions;
create trigger set_assessment_submissions_updated_at
before update on public.assessment_submissions
for each row execute function public.set_updated_at();

-- 4. Enable Row Level Security (RLS)
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assessment_submissions enable row level security;
alter table public.assessment_answers enable row level security;
alter table public.uploaded_scores enable row level security;

-- 5. Row Level Security Policies

-- assessments
drop policy if exists assessments_admin_all on public.assessments;
create policy assessments_admin_all on public.assessments
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists assessments_teacher_manage on public.assessments;
create policy assessments_teacher_manage on public.assessments
for all
using (public.is_teacher() and teacher_id = auth.uid())
with check (public.is_teacher() and teacher_id = auth.uid());

drop policy if exists assessments_student_read on public.assessments;
create policy assessments_student_read on public.assessments
for select
using (
  public.is_student() and status = 'published' and class_id = (
    select s.class_id from public.students s where s.user_id = auth.uid() limit 1
  )
);

-- assessment_questions
drop policy if exists questions_admin_all on public.assessment_questions;
create policy questions_admin_all on public.assessment_questions
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists questions_teacher_manage on public.assessment_questions;
create policy questions_teacher_manage on public.assessment_questions
for all
using (
  public.is_teacher() and exists (
    select 1 from public.assessments a
    where a.id = assessment_questions.assessment_id and a.teacher_id = auth.uid()
  )
)
with check (
  public.is_teacher() and exists (
    select 1 from public.assessments a
    where a.id = assessment_questions.assessment_id and a.teacher_id = auth.uid()
  )
);

drop policy if exists questions_student_read on public.assessment_questions;
create policy questions_student_read on public.assessment_questions
for select
using (
  public.is_student() and exists (
    select 1 from public.assessments a
    where a.id = assessment_questions.assessment_id and a.status = 'published' and a.class_id = (
      select s.class_id from public.students s where s.user_id = auth.uid() limit 1
    )
  )
);

-- assessment_submissions
drop policy if exists submissions_admin_all on public.assessment_submissions;
create policy submissions_admin_all on public.assessment_submissions
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists submissions_teacher_view_grade on public.assessment_submissions;
create policy submissions_teacher_view_grade on public.assessment_submissions
for all
using (
  public.is_teacher() and exists (
    select 1 from public.assessments a
    where a.id = assessment_submissions.assessment_id and a.teacher_id = auth.uid()
  )
)
with check (
  public.is_teacher() and exists (
    select 1 from public.assessments a
    where a.id = assessment_submissions.assessment_id and a.teacher_id = auth.uid()
  )
);

drop policy if exists submissions_student_own on public.assessment_submissions;
create policy submissions_student_own on public.assessment_submissions
for all
using (
  public.is_student() and student_id = public.current_student_id()
)
with check (
  public.is_student() and student_id = public.current_student_id()
);

-- assessment_answers
drop policy if exists answers_admin_all on public.assessment_answers;
create policy answers_admin_all on public.assessment_answers
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists answers_teacher_view_grade on public.assessment_answers;
create policy answers_teacher_view_grade on public.assessment_answers
for all
using (
  public.is_teacher() and exists (
    select 1 from public.assessment_submissions s
    join public.assessments a on s.assessment_id = a.id
    where s.id = assessment_answers.submission_id and a.teacher_id = auth.uid()
  )
)
with check (
  public.is_teacher() and exists (
    select 1 from public.assessment_submissions s
    join public.assessments a on s.assessment_id = a.id
    where s.id = assessment_answers.submission_id and a.teacher_id = auth.uid()
  )
);

drop policy if exists answers_student_own on public.assessment_answers;
create policy answers_student_own on public.assessment_answers
for all
using (
  public.is_student() and exists (
    select 1 from public.assessment_submissions s
    where s.id = assessment_answers.submission_id and s.student_id = public.current_student_id()
  )
)
with check (
  public.is_student() and exists (
    select 1 from public.assessment_submissions s
    where s.id = assessment_answers.submission_id and s.student_id = public.current_student_id()
  )
);

-- uploaded_scores
drop policy if exists uploaded_scores_admin_all on public.uploaded_scores;
create policy uploaded_scores_admin_all on public.uploaded_scores
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists uploaded_scores_teacher_manage on public.uploaded_scores;
create policy uploaded_scores_teacher_manage on public.uploaded_scores
for all
using (public.is_teacher() and teacher_id = auth.uid())
with check (public.is_teacher() and teacher_id = auth.uid());

drop policy if exists uploaded_scores_student_read on public.uploaded_scores;
create policy uploaded_scores_student_read on public.uploaded_scores
for select
using (public.is_student() and student_id = public.current_student_id());

-- Grants for the new tables
grant all on table public.assessments to authenticated;
grant all on table public.assessments to service_role;

grant all on table public.assessment_questions to authenticated;
grant all on table public.assessment_questions to service_role;

grant all on table public.assessment_submissions to authenticated;
grant all on table public.assessment_submissions to service_role;

grant all on table public.assessment_answers to authenticated;
grant all on table public.assessment_answers to service_role;

grant all on table public.uploaded_scores to authenticated;
grant all on table public.uploaded_scores to service_role;

-- Relax results table policies for teachers to allow any assigned teacher to write/update results.
drop policy if exists results_teacher_write on public.results;
create policy results_teacher_write on public.results
for insert
with check (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = results.student_id
      and public.teacher_has_assignment(s.class_id, results.subject_id)
  )
  and results.status in ('draft', 'published')
);

drop policy if exists results_teacher_update on public.results;
create policy results_teacher_update on public.results
for update
using (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = results.student_id
      and public.teacher_has_assignment(s.class_id, results.subject_id)
  )
  and results.status in ('draft', 'published', 'approved')
)
with check (
  public.is_teacher()
  and exists (
    select 1
    from public.students s
    where s.id = results.student_id
      and public.teacher_has_assignment(s.class_id, results.subject_id)
  )
  and results.status in ('draft', 'published')
);


-- ============================================================
-- Source: supabase\cbt_extensions.sql
-- ============================================================

-- Migration: CBT Extensions â€” Promotions & Student History
-- Run AFTER schema.sql, rls.sql, and quiz_module.sql
-- Apply in Supabase SQL editor.

-- â”€â”€â”€ promotions table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Records each bulk promotion event triggered by the admin.
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  session text not null,           -- e.g. '2024/2025' â€” the session being completed
  promoted_by uuid not null,       -- admin auth.uid()
  promoted_at timestamptz not null default now(),
  summary jsonb not null default '[]'::jsonb,
  -- summary is an array of { student_id, student_name, from_class, to_class, graduated }
  notes text
);
create index if not exists promotions_session_idx on public.promotions(session);
create index if not exists promotions_promoted_by_idx on public.promotions(promoted_by);

-- RLS for promotions (admin only)
alter table public.promotions enable row level security;

drop policy if exists promotions_admin_all on public.promotions;
create policy promotions_admin_all on public.promotions
for all
using (public.is_admin())
with check (public.is_admin());

-- Grants
grant all on table public.promotions to authenticated;
grant all on table public.promotions to service_role;

-- â”€â”€â”€ alumni_students table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- When SSS3 graduates are promoted, they are moved here as historical record.
-- Their student row is NOT deleted â€” class_id remains SSS3 and an is_alumni flag is set.
-- This table is a log only; the actual student profile stays in public.students.
create table if not exists public.alumni_students (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  graduated_session text not null,
  promotion_id uuid references public.promotions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (student_id, graduated_session)
);
create index if not exists alumni_students_student_id_idx on public.alumni_students(student_id);

alter table public.alumni_students enable row level security;

drop policy if exists alumni_admin_all on public.alumni_students;
create policy alumni_admin_all on public.alumni_students
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists alumni_read_authenticated on public.alumni_students;
create policy alumni_read_authenticated on public.alumni_students
for select
using (auth.role() = 'authenticated');

grant all on table public.alumni_students to authenticated;
grant all on table public.alumni_students to service_role;

-- â”€â”€â”€ is_alumni flag on students â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Soft flag to identify graduated students without deleting records.
alter table public.students add column if not exists is_alumni boolean not null default false;

-- â”€â”€â”€ Helper: ordered class progression map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Used by the promotion system to determine which class comes next.
-- Pattern: JSS 1 â†’ JSS 2 â†’ JSS 3 â†’ SSS 1 â†’ SSS 2 â†’ SSS 3 â†’ Alumni
-- This is handled in JS logic using class name pattern matching.

-- â”€â”€â”€ CBT analytics helper view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- A convenient view for admin analytics aggregating assessment stats.
create or replace view public.assessment_analytics as
select
  a.id as assessment_id,
  a.title,
  a.assessment_type,
  a.status,
  a.subject_id,
  sub.name as subject_name,
  a.class_id,
  cls.name as class_name,
  a.session,
  a.term,
  a.total_marks,
  a.pass_mark,
  a.created_at,
  count(s.id) as total_attempts,
  count(s.id) filter (where s.status = 'graded') as graded_attempts,
  avg(s.total_score) filter (where s.status = 'graded') as avg_score,
  avg(s.percentage) filter (where s.status = 'graded') as avg_percentage,
  count(s.id) filter (where s.status = 'graded' and s.total_score >= a.pass_mark) as pass_count,
  count(s.id) filter (where s.status = 'graded' and s.total_score < a.pass_mark) as fail_count
from public.assessments a
left join public.assessment_submissions s on s.assessment_id = a.id
left join public.subjects sub on sub.id = a.subject_id
left join public.classes cls on cls.id = a.class_id
group by a.id, sub.name, cls.name;

grant select on public.assessment_analytics to authenticated;
grant all on public.assessment_analytics to service_role;

-- â”€â”€â”€ student_evaluations table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Holds Affective & Psychomotor traits and remarks for each student per term/session.
create table if not exists public.student_evaluations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  term text not null check (public.is_valid_term(term)),
  session text not null,
  
  -- Affective traits (1 to 5)
  neatness int check (neatness between 1 and 5),
  honesty int check (honesty between 1 and 5),
  punctuality int check (punctuality between 1 and 5),
  politeness int check (politeness between 1 and 5),
  cooperation int check (cooperation between 1 and 5),
  leadership int check (leadership between 1 and 5),
  
  -- Psychomotor traits (1 to 5)
  handwriting int check (handwriting between 1 and 5),
  sports int check (sports between 1 and 5),
  crafts int check (crafts between 1 and 5),
  music int check (music between 1 and 5),
  
  -- Remarks
  teacher_remark text,
  principal_remark text,
  
  submitted_by uuid references public.users(auth_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, term, session)
);

create index if not exists evaluations_student_id_idx on public.student_evaluations(student_id);
create index if not exists evaluations_term_session_idx on public.student_evaluations(term, session);

-- Triggers for updated_at
drop trigger if exists set_student_evaluations_updated_at on public.student_evaluations;
create trigger set_student_evaluations_updated_at
before update on public.student_evaluations
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.student_evaluations enable row level security;

-- Admin Policy
drop policy if exists evaluations_admin_all on public.student_evaluations;
create policy evaluations_admin_all on public.student_evaluations
for all using (public.is_admin()) with check (public.is_admin());

-- Teacher Policy
drop policy if exists evaluations_teacher_all on public.student_evaluations;
create policy evaluations_teacher_all on public.student_evaluations
for all
using (
  public.is_teacher() and exists (
    select 1 from public.students s
    where s.id = student_evaluations.student_id
      and public.teacher_has_class(s.class_id)
  )
)
with check (
  public.is_teacher() and exists (
    select 1 from public.students s
    where s.id = student_evaluations.student_id
      and public.teacher_has_class(s.class_id)
  )
);

-- Student Policy
drop policy if exists evaluations_student_read on public.student_evaluations;
create policy evaluations_student_read on public.student_evaluations
for select
using (
  public.is_student() and student_id = public.current_student_id()
);

-- Grants
grant all on table public.student_evaluations to authenticated;
grant all on table public.student_evaluations to service_role;



-- ============================================================
-- Source: supabase\cbt_automation.sql
-- ============================================================

-- Migration: Enhanced CBT Auto-Grading & CA Component Scaling Schema
-- Apply in Supabase SQL editor.

-- â”€â”€â”€ 1. Assessment Grading Rules Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists public.assessment_grading_rules (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_id uuid not null references public.assessment_questions(id) on delete cascade,
  question_type text not null, -- 'Multiple Choice', 'True / False', 'Fill in the Blank', 'Short Answer', 'Essay'
  auto_grade boolean default true,
  correct_answer text,
  keyword_match_required boolean default false,
  keywords text[] default '{}'::text[], -- Keywords for short answer match
  marking_rubric jsonb default '{}'::jsonb, -- e.g., {'excellent': 10, 'good': 8, 'fair': 5, 'poor': 0}
  marks_per_question numeric(5, 2) not null default 1.00,
  created_at timestamptz not null default now(),
  unique (assessment_id, question_id)
);

create index if not exists grading_rules_assessment_id_idx on public.assessment_grading_rules(assessment_id);

-- â”€â”€â”€ 2. CBT Score Scaling Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Maps raw assessment totals to continuous assessment (CA) gradebook components
create table if not exists public.cbt_score_scaling (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid unique not null references public.assessments(id) on delete cascade,
  term text check (term in ('term1', 'term2', 'term3')),
  ca_component text not null check (ca_component in ('classwork', 'assignment', 'test', 'project', 'exam')),
  total_raw_marks numeric(6, 2) not null default 100.00,
  scale_to numeric(6, 2) not null default 10.00,
  scale_formula text default 'linear', -- 'linear', 'percentage', 'custom'
  auto_export_on_graded boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cbt_score_scaling_assessment_id_idx on public.cbt_score_scaling(assessment_id);

-- â”€â”€â”€ 3. CBT Attempt History Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists public.cbt_attempt_history (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.assessment_submissions(id) on delete cascade,
  attempt_number int not null default 1,
  status text not null check (status in ('started', 'in_progress', 'submitted', 'graded')),
  score_before_grading numeric(6, 2) default 0.00,
  score_after_grading numeric(6, 2) default 0.00,
  manual_adjustments numeric(6, 2) default 0.00,
  adjusted_by uuid references public.users(auth_id) on delete set null,
  adjustment_reason text,
  created_at timestamptz not null default now()
);

create index if not exists cbt_attempt_history_submission_idx on public.cbt_attempt_history(submission_id);

-- â”€â”€â”€ Row Level Security (RLS) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
alter table public.assessment_grading_rules enable row level security;
alter table public.cbt_score_scaling enable row level security;
alter table public.cbt_attempt_history enable row level security;

-- Admin policies
drop policy if exists grading_rules_admin_all on public.assessment_grading_rules;
create policy grading_rules_admin_all on public.assessment_grading_rules for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists cbt_scaling_admin_all on public.cbt_score_scaling;
create policy cbt_scaling_admin_all on public.cbt_score_scaling for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists attempt_history_admin_all on public.cbt_attempt_history;
create policy attempt_history_admin_all on public.cbt_attempt_history for all using (public.is_admin()) with check (public.is_admin());

-- Teacher policies
drop policy if exists grading_rules_teacher_all on public.assessment_grading_rules;
create policy grading_rules_teacher_all on public.assessment_grading_rules for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists cbt_scaling_teacher_all on public.cbt_score_scaling;
create policy cbt_scaling_teacher_all on public.cbt_score_scaling for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists attempt_history_teacher_all on public.cbt_attempt_history;
create policy attempt_history_teacher_all on public.cbt_attempt_history for all using (public.is_teacher()) with check (public.is_teacher());

-- Grants
grant all on table public.assessment_grading_rules to authenticated, service_role;
grant all on table public.cbt_score_scaling to authenticated, service_role;
grant all on table public.cbt_attempt_history to authenticated, service_role;


-- ============================================================
-- Source: supabase\setup_first_admin.sql
-- ============================================================

-- Run AFTER schema.sql + rls.sql on a NEW Supabase project.
--
-- 1. Supabase Dashboard â†’ Authentication â†’ Users â†’ Add user
--    (email + password you will use to log in)
-- 2. Copy that user's UUID from the Users table
-- 3. Replace PASTE-AUTH-USER-UUID below and run this script

insert into public.users (auth_id, email, display_name, role)
values (
  'PASTE-AUTH-USER-UUID',
  'admin@gracemark.edu.ng',
  'Admin',
  'admin'
)
on conflict (auth_id) do update
set role = 'admin', display_name = excluded.display_name, email = excluded.email;


-- ============================================================
-- Final finance/payment normalization (authoritative section)
-- ============================================================
create extension if not exists pgcrypto;

alter table public.students add column if not exists portal_access_status text not null default 'ACTIVE';
alter table public.students add column if not exists portal_lock_reason text;
alter table public.students add column if not exists portal_locked_at timestamptz;
alter table public.students add column if not exists portal_locked_by uuid references public.users(auth_id) on delete set null;
alter table public.students drop constraint if exists students_portal_access_status_check;
alter table public.students add constraint students_portal_access_status_check check (portal_access_status in ('ACTIVE', 'LOCKED'));

create table if not exists public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_current boolean not null default false,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  term_code text not null unique check (term_code in ('term1', 'term2', 'term3')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.academic_terms (name, term_code, is_current)
values ('First Term', 'term1', true), ('Second Term', 'term2', false), ('Third Term', 'term3', false)
on conflict (term_code) do nothing;

create table if not exists public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  academic_session text not null,
  term text not null,
  fee_type text not null default 'School Fees',
  tuition_amount numeric(10, 2) not null default 0,
  registration_fee numeric(10, 2) not null default 0,
  exams_fee numeric(10, 2) not null default 0,
  facilities_fee numeric(10, 2) not null default 0,
  status text not null default 'active',
  due_date date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fee_structures add column if not exists school_id uuid references public.schools(id) on delete cascade;
alter table public.fee_structures add column if not exists class_id uuid references public.classes(id) on delete cascade;
alter table public.fee_structures add column if not exists academic_session text;
alter table public.fee_structures add column if not exists term text;
alter table public.fee_structures add column if not exists fee_type text not null default 'School Fees';
alter table public.fee_structures add column if not exists tuition_amount numeric(10, 2) not null default 0;
alter table public.fee_structures add column if not exists registration_fee numeric(10, 2) not null default 0;
alter table public.fee_structures add column if not exists exams_fee numeric(10, 2) not null default 0;
alter table public.fee_structures add column if not exists facilities_fee numeric(10, 2) not null default 0;
alter table public.fee_structures add column if not exists status text not null default 'active';
alter table public.fee_structures add column if not exists due_date date;
alter table public.fee_structures add column if not exists description text;
alter table public.fee_structures add column if not exists updated_at timestamptz not null default now();
alter table public.fee_structures drop constraint if exists fee_structures_status_check;
alter table public.fee_structures add constraint fee_structures_status_check check (status in ('active', 'inactive'));
create index if not exists fee_structures_class_idx on public.fee_structures(class_id);
create index if not exists fee_structures_session_idx on public.fee_structures(academic_session);

create table if not exists public.payment_invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  fee_structure_id uuid references public.fee_structures(id) on delete set null,
  class_id uuid references public.classes(id) on delete set null,
  academic_session text not null,
  term text not null,
  total_amount numeric(10, 2) not null default 0,
  amount_paid numeric(10, 2) not null default 0,
  status text not null default 'UNPAID',
  due_date date,
  issued_date timestamptz not null default now(),
  invoice_number text unique not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_invoices add column if not exists fee_structure_id uuid references public.fee_structures(id) on delete set null;
alter table public.payment_invoices add column if not exists class_id uuid references public.classes(id) on delete set null;
alter table public.payment_invoices add column if not exists academic_session text;
alter table public.payment_invoices add column if not exists term text;
alter table public.payment_invoices add column if not exists total_amount numeric(10, 2) not null default 0;
alter table public.payment_invoices add column if not exists amount_paid numeric(10, 2) not null default 0;
alter table public.payment_invoices add column if not exists status text not null default 'UNPAID';
alter table public.payment_invoices add column if not exists due_date date;
alter table public.payment_invoices add column if not exists issued_date timestamptz not null default now();
alter table public.payment_invoices add column if not exists notes text;
alter table public.payment_invoices add column if not exists updated_at timestamptz not null default now();
alter table public.payment_invoices drop constraint if exists payment_invoices_status_check;
alter table public.payment_invoices add constraint payment_invoices_status_check check (status in ('UNPAID', 'PARTIALLY PAID', 'FULLY PAID', 'draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'));
create index if not exists payment_invoices_student_id_idx on public.payment_invoices(student_id);
create index if not exists payment_invoices_session_term_idx on public.payment_invoices(academic_session, term);
create unique index if not exists payment_invoices_student_session_term_idx on public.payment_invoices(student_id, academic_session, term);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.payment_invoices(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  payment_reference text unique not null,
  receipt_number text unique,
  amount numeric(10, 2) not null default 0,
  payment_gateway text not null default 'paystack',
  gateway_response jsonb,
  status text not null default 'pending',
  payment_date timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references public.users(auth_id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.payment_records add column if not exists student_id uuid references public.students(id) on delete cascade;
alter table public.payment_records add column if not exists receipt_number text;
alter table public.payment_records add column if not exists gateway_response jsonb;
alter table public.payment_records add column if not exists verified_at timestamptz;
alter table public.payment_records add column if not exists verified_by uuid references public.users(auth_id) on delete set null;
alter table public.payment_records drop constraint if exists payment_records_status_check;
alter table public.payment_records add constraint payment_records_status_check check (status in ('pending', 'successful', 'success', 'failed', 'cancelled'));
alter table public.payment_records drop constraint if exists payment_records_payment_gateway_check;
alter table public.payment_records add constraint payment_records_payment_gateway_check check (payment_gateway in ('paystack', 'flutterwave', 'manual'));
create unique index if not exists payment_records_payment_reference_idx on public.payment_records(payment_reference);
create unique index if not exists payment_records_receipt_number_idx on public.payment_records(receipt_number) where receipt_number is not null;
create index if not exists payment_records_student_idx on public.payment_records(student_id);
create index if not exists payment_records_invoice_idx on public.payment_records(invoice_id);

create table if not exists public.portal_access_settings (
  id uuid primary key default gen_random_uuid(),
  restrict_outstanding_fees boolean not null default false,
  lock_after_due_date boolean not null default false,
  grace_period_days int not null default 7,
  auto_unlock_on_full_payment boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.portal_access_settings (restrict_outstanding_fees, lock_after_due_date, grace_period_days, auto_unlock_on_full_payment)
select false, false, 7, true
where not exists (select 1 from public.portal_access_settings);

alter table public.academic_sessions enable row level security;
alter table public.academic_terms enable row level security;
alter table public.fee_structures enable row level security;
alter table public.payment_invoices enable row level security;
alter table public.payment_records enable row level security;
alter table public.portal_access_settings enable row level security;

drop policy if exists fee_structures_admin_all on public.fee_structures;
create policy fee_structures_admin_all on public.fee_structures for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists fee_structures_read_auth on public.fee_structures;
create policy fee_structures_read_auth on public.fee_structures for select using (auth.role() = 'authenticated');

drop policy if exists payment_invoices_admin_all on public.payment_invoices;
create policy payment_invoices_admin_all on public.payment_invoices for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists payment_invoices_student_read on public.payment_invoices;
drop policy if exists payment_invoices_student_all on public.payment_invoices;
create policy payment_invoices_student_all on public.payment_invoices for all
  using (public.is_student() and student_id = public.current_student_id())
  with check (public.is_student() and student_id = public.current_student_id());

drop policy if exists payment_records_admin_all on public.payment_records;
create policy payment_records_admin_all on public.payment_records for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists payment_records_student_read on public.payment_records;
drop policy if exists payment_records_student_all on public.payment_records;
create policy payment_records_student_all on public.payment_records for all
  using (public.is_student() and student_id = public.current_student_id())
  with check (public.is_student() and student_id = public.current_student_id());

drop policy if exists portal_settings_admin_all on public.portal_access_settings;
create policy portal_settings_admin_all on public.portal_access_settings for all using (public.is_admin()) with check (public.is_admin());

grant all on table public.fee_structures to authenticated, service_role;
grant all on table public.payment_invoices to authenticated, service_role;
grant all on table public.payment_records to authenticated, service_role;
grant all on table public.portal_access_settings to authenticated, service_role;

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
  if p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Invalid payment amount');
  end if;

  select * into v_existing_rec from payment_records where payment_reference = p_reference limit 1;
  if found and v_existing_rec.status in ('successful', 'success') then
    select coalesce(sum(amount), 0) into v_total_paid
    from payment_records
    where invoice_id = v_existing_rec.invoice_id and status in ('successful', 'success');

    select * into v_invoice from payment_invoices where id = v_existing_rec.invoice_id;
    v_balance := greatest(0, coalesce(v_invoice.total_amount, 0) - v_total_paid);

    return jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'receipt_number', v_existing_rec.receipt_number,
      'total_paid', v_total_paid,
      'outstanding_balance', v_balance,
      'status', v_invoice.status
    );
  end if;

  select * into v_invoice from payment_invoices where id = p_invoice_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found');
  end if;

  if v_invoice.student_id <> p_student_id then
    return jsonb_build_object('ok', false, 'error', 'Invoice does not belong to this student');
  end if;

  insert into payment_records (
    invoice_id, student_id, payment_reference, receipt_number,
    amount, payment_gateway, status, payment_date, verified_at
  ) values (
    p_invoice_id, p_student_id, p_reference, p_receipt_number,
    p_amount, 'paystack', 'successful', now(), now()
  )
  on conflict (payment_reference) do update
    set receipt_number = coalesce(payment_records.receipt_number, excluded.receipt_number),
        amount = excluded.amount,
        status = 'successful',
        verified_at = now();

  select coalesce(sum(amount), 0) into v_total_paid
  from payment_records
  where invoice_id = p_invoice_id and status in ('successful', 'success');

  v_balance := greatest(0, v_invoice.total_amount - v_total_paid);
  if v_balance <= 0 and v_invoice.total_amount > 0 then
    v_new_status := 'FULLY PAID';
  elsif v_total_paid > 0 then
    v_new_status := 'PARTIALLY PAID';
  else
    v_new_status := 'UNPAID';
  end if;

  update payment_invoices
  set amount_paid = v_total_paid, status = v_new_status, updated_at = now()
  where id = p_invoice_id;

  if v_new_status = 'FULLY PAID' then
    update students
    set portal_access_status = 'ACTIVE', portal_lock_reason = null
    where id = p_student_id and portal_access_status = 'LOCKED';
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

grant execute on function public.record_student_payment(uuid, uuid, text, numeric, text) to authenticated;
notify pgrst, 'reload schema';
