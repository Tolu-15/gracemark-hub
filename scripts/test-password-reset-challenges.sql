-- Run after the academic fixture, which creates the Supabase roles.
\set ON_ERROR_STOP on
create schema auth;
create table auth.users(id uuid primary key);
\ir ../supabase/048_password_reset_challenges.sql

\ir ../supabase/049_single_use_reset.sql

do $$
declare u uuid:=gen_random_uuid();
begin
 insert into auth.users values(u);
 if not public.issue_password_reset_challenge(u,'first') then raise exception 'Initial issue failed'; end if;
 if public.issue_password_reset_challenge(u,'second') then raise exception 'Cooldown failed'; end if;
 if public.consume_password_reset_challenge(u,'wrong') then raise exception 'Incorrect code accepted'; end if;
 if not public.exchange_reset_code(u,'first','token') then raise exception 'Valid code rejected'; end if;
 if public.consume_password_reset_challenge(u,'first') then raise exception 'Used code accepted'; end if;
if not public.claim_reset_token(u,'token') then raise exception 'First reset refused'; end if;
 if public.claim_reset_token(u,'token') then raise exception 'Second password change authorized'; end if;
end $$;
