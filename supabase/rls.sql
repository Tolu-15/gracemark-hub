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
