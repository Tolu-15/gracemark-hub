-- Migration: Enhanced CBT Auto-Grading & CA Component Scaling Schema
-- Apply in Supabase SQL editor.

-- ─── 1. Assessment Grading Rules Table ───────────────────────────────────────
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

-- ─── 2. CBT Score Scaling Table ──────────────────────────────────────────────
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

-- ─── 3. CBT Attempt History Table ────────────────────────────────────────────
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

-- ─── Row Level Security (RLS) ────────────────────────────────────────────────
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
