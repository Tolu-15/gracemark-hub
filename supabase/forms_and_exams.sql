-- Gracemark SQL Migration: Custom Forms, Paystack Payments, CBT Exams & RLS Policies
-- Safe to re-run multiple times in Supabase SQL Editor

create extension if not exists pgcrypto;

-- Helper block to safely recreate policies without 42710 errors
do $$
begin
  -- 1. Users Table RLS
  alter table public.users disable row level security;
  alter table public.users enable row level security;
  execute 'drop policy if exists "Allow all operations on users" on public.users';
  execute 'create policy "Allow all operations on users" on public.users for all using (true) with check (true)';

  -- 2. Students Table RLS
  alter table public.students disable row level security;
  alter table public.students enable row level security;
  execute 'drop policy if exists "Allow all operations on students" on public.students';
  execute 'create policy "Allow all operations on students" on public.students for all using (true) with check (true)';
end $$;

grant all on table public.users to authenticated, anon, service_role;
grant all on table public.students to authenticated, anon, service_role;

-- 3. Custom Forms Table
create table if not exists public.custom_forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  class_id uuid references public.classes(id) on delete set null,
  fee_amount numeric(10, 2) not null default 0.00,
  form_fields jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.custom_forms disable row level security;
  alter table public.custom_forms enable row level security;
  execute 'drop policy if exists "Allow all operations on custom_forms" on public.custom_forms';
  execute 'create policy "Allow all operations on custom_forms" on public.custom_forms for all using (true) with check (true)';
end $$;

grant all on table public.custom_forms to authenticated, anon, service_role;

-- 4. Form Submissions & Payment Tracking Table
create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.custom_forms(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  applicant_name text not null,
  applicant_email text not null,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'free', 'failed')),
  payment_ref text,
  form_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.form_submissions disable row level security;
  alter table public.form_submissions enable row level security;
  execute 'drop policy if exists "Allow all operations on form_submissions" on public.form_submissions';
  execute 'create policy "Allow all operations on form_submissions" on public.form_submissions for all using (true) with check (true)';
end $$;

grant all on table public.form_submissions to authenticated, anon, service_role;

-- 5. CBT Exams Table
create table if not exists public.cbt_exams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  duration_minutes int not null default 30,
  pass_mark int not null default 50,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.cbt_exams disable row level security;
  alter table public.cbt_exams enable row level security;
  execute 'drop policy if exists "Allow all operations on cbt_exams" on public.cbt_exams';
  execute 'create policy "Allow all operations on cbt_exams" on public.cbt_exams for all using (true) with check (true)';
end $$;

grant all on table public.cbt_exams to authenticated, anon, service_role;

-- 6. CBT Questions Table
create table if not exists public.cbt_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.cbt_exams(id) on delete cascade,
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  correct_option_index int not null default 0,
  points int not null default 1,
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.cbt_questions disable row level security;
  alter table public.cbt_questions enable row level security;
  execute 'drop policy if exists "Allow all operations on cbt_questions" on public.cbt_questions';
  execute 'create policy "Allow all operations on cbt_questions" on public.cbt_questions for all using (true) with check (true)';
end $$;

grant all on table public.cbt_questions to authenticated, anon, service_role;

-- 7. CBT Submissions Table
create table if not exists public.cbt_submissions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.cbt_exams(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  score int not null default 0,
  total_questions int not null default 0,
  passed boolean not null default false,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  unique (exam_id, student_id)
);

do $$
begin
  alter table public.cbt_submissions disable row level security;
  alter table public.cbt_submissions enable row level security;
  execute 'drop policy if exists "Allow all operations on cbt_submissions" on public.cbt_submissions';
  execute 'create policy "Allow all operations on cbt_submissions" on public.cbt_submissions for all using (true) with check (true)';
end $$;

grant all on table public.cbt_submissions to authenticated, anon, service_role;
