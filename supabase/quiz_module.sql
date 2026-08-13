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
