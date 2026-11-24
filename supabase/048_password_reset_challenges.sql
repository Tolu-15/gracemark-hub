begin;
create table public.password_reset_challenges (
 auth_id uuid primary key references auth.users(id) on delete cascade,
 digest text not null, issued_at timestamptz not null, attempts integer not null,
 window_start timestamptz not null, sends integer not null
);
alter table public.password_reset_challenges enable row level security;
revoke all on public.password_reset_challenges from public,anon,authenticated;
grant all on public.password_reset_challenges to service_role;
create function public.issue_password_reset_challenge(p_user uuid,p_digest text) returns boolean
language plpgsql set search_path='' as $$
begin
  insert into public.password_reset_challenges as c values(p_user,p_digest,now(),0,now(),1)
  on conflict(auth_id) do update set digest=p_digest,issued_at=now(),attempts=0,
    sends=case when c.window_start <= now()-interval '1 hour' then 1 else c.sends+1 end,
    window_start=case when c.window_start <= now()-interval '1 hour' then now() else c.window_start end
  where c.issued_at <= now()-interval '1 minute' and (c.sends<5 or c.window_start <= now()-interval '1 hour');
  return found;
end $$;
create function public.consume_password_reset_challenge(p_user uuid,p_digest text) returns boolean
language plpgsql set search_path='' as $$
declare c public.password_reset_challenges;
begin
  select * into c from public.password_reset_challenges where auth_id=p_user for update;
  if not found or c.issued_at<=now()-interval '10 minutes' or c.attempts>=5 then return false; end if;
  if c.digest<>p_digest then
    update public.password_reset_challenges set attempts=attempts+1 where auth_id=p_user;
    return false;
  end if;
  update public.password_reset_challenges set attempts=5,digest='' where auth_id=p_user;
  return true;
end $$;
revoke all on function public.issue_password_reset_challenge(uuid,text),public.consume_password_reset_challenge(uuid,text) from public,anon,authenticated;
grant execute on function public.issue_password_reset_challenge(uuid,text),public.consume_password_reset_challenge(uuid,text) to service_role;
commit;
