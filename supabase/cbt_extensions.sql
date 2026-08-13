-- Migration: CBT Extensions — Promotions & Student History
-- Run AFTER schema.sql, rls.sql, and quiz_module.sql
-- Apply in Supabase SQL editor.

-- ─── promotions table ───────────────────────────────────────────────────────
-- Records each bulk promotion event triggered by the admin.
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  session text not null,           -- e.g. '2024/2025' — the session being completed
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

-- ─── alumni_students table ───────────────────────────────────────────────────
-- When SSS3 graduates are promoted, they are moved here as historical record.
-- Their student row is NOT deleted — class_id remains SSS3 and an is_alumni flag is set.
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

-- ─── is_alumni flag on students ─────────────────────────────────────────────
-- Soft flag to identify graduated students without deleting records.
alter table public.students add column if not exists is_alumni boolean not null default false;

-- ─── Helper: ordered class progression map ──────────────────────────────────
-- Used by the promotion system to determine which class comes next.
-- Pattern: JSS 1 → JSS 2 → JSS 3 → SSS 1 → SSS 2 → SSS 3 → Alumni
-- This is handled in JS logic using class name pattern matching.

-- ─── CBT analytics helper view ──────────────────────────────────────────────
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

-- ─── student_evaluations table ─────────────────────────────────────────────
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

