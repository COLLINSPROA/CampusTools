-- CampusTools initial database schema.
-- Run this in Supabase Dashboard > SQL Editor.
-- Every public registration receives role='user'. Never accept a role from browser input.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  created_at timestamptz not null default now()
);

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
  insert into public.passkey_login_rate_limits as limits
    (requester_hash, window_started_at, request_count)
  values (p_requester_hash, v_now, 1)
  on conflict (requester_hash) do update set
      else limits.request_count + 1
    end
  returning request_count into v_request_count;


revoke all on function public.consume_passkey_login_rate_limit(text)
    public.passkey_verified_sessions

-- Create a profile automatically for each new auth user.
    public.passkey_verified_sessions to service_role;
alter table public.profiles enable row level security;
alter table public.usage_events enable row level security;

-- Do not grant users permission to change role or other protected columns.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists "Users can read own profile or admins can read all" on public.profiles;
create policy "Users can read own profile or admins can read all"
on public.profiles for select to authenticated
using (
  (select auth.uid()) = id
  or public.is_admin()
);

drop policy if exists "Users can update own display name" on public.profiles;
create policy "Users can update own display name"
on public.profiles for update to authenticated
using ((select auth.uid()) = id and (select auth.jwt() ->> 'aal') = 'aal2')
with check ((select auth.uid()) = id and (select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists "Users can read own usage" on public.usage_events;
create policy "Users can read own usage"
on public.usage_events for select to authenticated
using (
  (select auth.jwt() ->> 'aal') = 'aal2'
  and ((select auth.uid()) = user_id or public.is_admin())
);

drop policy if exists "Users can record own usage" on public.usage_events;
create policy "Users can record own usage"
on public.usage_events for insert to authenticated
with check (
  (select auth.jwt() ->> 'aal') = 'aal2'
  and (select auth.uid()) = user_id
);

grant select, insert on public.usage_events to authenticated;
grant usage, select on sequence public.usage_events_id_seq to authenticated;

-- IMPORTANT: After you create and confirm your own account, find its UUID
-- under Authentication > Users. Then run this statement manually in SQL Editor,
-- replacing the UUID. Never expose an admin-promotion function to the browser.
-- update public.profiles set role = 'admin' where id = 'YOUR-AUTH-USER-UUID';
