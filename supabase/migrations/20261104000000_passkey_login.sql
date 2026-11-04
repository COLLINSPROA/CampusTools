create extension if not exists pgcrypto;

create table if not exists public.passkey_credentials (
  credential_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  public_key text not null,
  sign_count bigint not null default 0,
  transports text[] not null default '{}',
  device_type text not null,
  backed_up boolean not null default false,
  friendly_name text not null default 'My device',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  challenge_type text not null check (challenge_type in ('registration', 'authentication')),
  challenge text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists public.passkey_verified_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  verified_at timestamptz not null default now()
);

create table if not exists public.passkey_login_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists public.passkey_login_tickets (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists public.passkey_login_rate_limits (
  requester_hash text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

create index if not exists passkey_credentials_user_id_idx
  on public.passkey_credentials (user_id);
create index if not exists passkey_challenges_expiry_idx
  on public.passkey_challenges (expires_at);
create index if not exists passkey_login_challenges_expiry_idx
  on public.passkey_login_challenges (expires_at);
create index if not exists passkey_login_tickets_expiry_idx
  on public.passkey_login_tickets (expires_at);
create index if not exists passkey_login_rate_limits_window_idx
  on public.passkey_login_rate_limits (window_started_at);

alter table public.passkey_credentials enable row level security;
alter table public.passkey_challenges enable row level security;
alter table public.passkey_verified_sessions enable row level security;
alter table public.passkey_login_challenges enable row level security;
alter table public.passkey_login_tickets enable row level security;
alter table public.passkey_login_rate_limits enable row level security;

revoke all on public.passkey_credentials, public.passkey_challenges,
  public.passkey_verified_sessions, public.passkey_login_challenges,
  public.passkey_login_tickets, public.passkey_login_rate_limits
  from anon, authenticated;
grant all on public.passkey_credentials, public.passkey_challenges,
  public.passkey_verified_sessions, public.passkey_login_challenges,
  public.passkey_login_tickets, public.passkey_login_rate_limits to service_role;

create or replace function public.consume_passkey_login_rate_limit(p_requester_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_request_count integer;
begin
  delete from public.passkey_login_rate_limits
  where window_started_at < v_now - interval '1 day';

  insert into public.passkey_login_rate_limits as limits
    (requester_hash, window_started_at, request_count)
  values (p_requester_hash, v_now, 1)
  on conflict (requester_hash) do update set
    window_started_at = case
      when limits.window_started_at <= v_now - interval '1 minute' then v_now
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= v_now - interval '1 minute' then 1
      else limits.request_count + 1
    end
  returning request_count into v_request_count;

  return v_request_count <= 30;
end;
$$;

revoke all on function public.consume_passkey_login_rate_limit(text)
  from public, anon, authenticated;
grant execute on function public.consume_passkey_login_rate_limit(text) to service_role;