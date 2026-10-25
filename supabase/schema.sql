-- Astronom observability + auth (Supabase Postgres).
-- Paste into the Supabase SQL editor and run once.
--
-- Dashboard steps after this script:
--   1. Authentication > Providers > Google: enable it
--   2. Add redirect URL: http://localhost:3000/auth/callback
--   3. Copy Project URL, anon key, and service role key into apps/web/.env.local

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  workspace_id text not null default 'ws_astronom',
  role text not null default 'engineer',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.auth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  email text,
  event text not null,
  provider text,
  ip text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  source text not null,
  run_id text,
  agent_id text,
  agent_name text,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  data_class text,
  created_at timestamptz not null default now()
);

create table if not exists public.prompt_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  source text not null,
  run_id text,
  agent_id text,
  model text,
  step integer,
  messages jsonb not null default '[]'::jsonb,
  completion text,
  input_tokens integer,
  output_tokens integer,
  content_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  actor text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_workspace_created_idx
  on public.usage_events (workspace_id, created_at desc);
create index if not exists usage_events_run_idx
  on public.usage_events (run_id);
create index if not exists prompt_logs_workspace_created_idx
  on public.prompt_logs (workspace_id, created_at desc);
create index if not exists prompt_logs_run_idx
  on public.prompt_logs (run_id);
create index if not exists auth_events_created_idx
  on public.auth_events (created_at desc);
create index if not exists activity_events_workspace_created_idx
  on public.activity_events (workspace_id, created_at desc);

-- Profiles follow auth.users. Telemetry tables have RLS on and no client
-- policies, so only the service role (Next.js server) can read or write them.
alter table public.profiles enable row level security;
alter table public.auth_events enable row level security;
alter table public.usage_events enable row level security;
alter table public.prompt_logs enable row level security;
alter table public.activity_events enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
