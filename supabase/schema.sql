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

-- Create a profile automatically for each new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Security helper avoids recursive profiles-table RLS checks.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

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
