-- Apply this if you already ran `supabase/schema.sql` before workflow columns existed,
-- or if `classes` was created from an older script without school_id.

-- ---------- Legacy classes → current schema ----------
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
    execute $$alter table public.results
      add constraint results_status_check
      check (status in ('draft','published','approved'))$$;
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
