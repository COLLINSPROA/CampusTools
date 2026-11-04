delete from public.passkey_verified_sessions;

drop function if exists public.consume_passkey_login_rate_limit(text);
drop table if exists public.passkey_login_tickets;
drop table if exists public.passkey_login_challenges;
drop table if exists public.passkey_login_rate_limits;