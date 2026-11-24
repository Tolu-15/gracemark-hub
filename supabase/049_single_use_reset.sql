alter table public.password_reset_challenges add column token_digest text, add column token_expires_at timestamptz;
create function public.exchange_reset_code(p_user uuid,p_code text,p_token text) returns boolean language plpgsql set search_path='' as $$
begin
 if not public.consume_password_reset_challenge(p_user,p_code) then return false; end if;
 update public.password_reset_challenges set token_digest=p_token,token_expires_at=now()+interval '15 minutes' where auth_id=p_user;
 return true;
end $$;
create function public.claim_reset_token(p_user uuid,p_token text) returns boolean language plpgsql set search_path='' as $$
begin
 update public.password_reset_challenges set token_digest=null,token_expires_at=null
 where auth_id=p_user and digest='' and token_digest=p_token and token_expires_at>now();
 return found;
end $$;
revoke all on function public.exchange_reset_code(uuid,text,text),public.claim_reset_token(uuid,text) from public,anon,authenticated;
grant execute on function public.exchange_reset_code(uuid,text,text),public.claim_reset_token(uuid,text) to service_role;
