create table public.admin_login_challenges (
  auth_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null, digest text not null, issued_at timestamptz not null,
  attempts integer not null, window_start timestamptz not null, sends integer not null
);
create table public.verified_admin_sessions (
  session_id uuid primary key, auth_id uuid not null references auth.users(id) on delete cascade, expires_at timestamptz not null
);
alter table public.admin_login_challenges enable row level security;
alter table public.verified_admin_sessions enable row level security;
revoke all on public.admin_login_challenges,public.verified_admin_sessions from public,anon,authenticated;
grant all on public.admin_login_challenges,public.verified_admin_sessions to service_role;

create function public.issue_admin_challenge(p_user uuid,p_session uuid,p_digest text) returns boolean
language plpgsql set search_path='' as $$
begin
  insert into public.admin_login_challenges as c values(p_user,p_session,p_digest,now(),0,now(),1)
  on conflict(auth_id) do update set session_id=p_session,digest=p_digest,issued_at=now(),attempts=0,
    sends=case when c.window_start <= now()-interval '1 hour' then 1 else c.sends+1 end,
    window_start=case when c.window_start <= now()-interval '1 hour' then now() else c.window_start end
  where c.issued_at <= now()-interval '1 minute' and (c.sends<5 or c.window_start <= now()-interval '1 hour');
  return found;
end $$;
create function public.consume_admin_challenge(p_user uuid,p_session uuid,p_digest text) returns boolean
language plpgsql set search_path='' as $$
declare c public.admin_login_challenges;
begin
  select * into c from public.admin_login_challenges where auth_id=p_user for update;
  if not found or c.session_id<>p_session or c.issued_at<=now()-interval '10 minutes' or c.attempts>=5 then return false; end if;
  if c.digest<>p_digest then
    update public.admin_login_challenges set attempts=attempts+1 where auth_id=p_user;
    return false;
  end if;
  update public.admin_login_challenges set attempts=5,digest='' where auth_id=p_user;
  insert into public.verified_admin_sessions values(p_session,p_user,now()+interval '30 days')
    on conflict(session_id) do update set expires_at=excluded.expires_at where verified_admin_sessions.auth_id=p_user;
  return true;
end $$;
revoke all on function public.issue_admin_challenge(uuid,uuid,text),public.consume_admin_challenge(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.issue_admin_challenge(uuid,uuid,text),public.consume_admin_challenge(uuid,uuid,text) to service_role;
