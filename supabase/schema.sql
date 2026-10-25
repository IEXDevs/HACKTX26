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
-- policies. Projects created with "Automatically expose new tables" off do
-- not grant Data API roles, so the service role must be granted explicitly
-- or Next.js gets 42501 permission denied and login/usage logging is empty.
alter table public.profiles enable row level security;
alter table public.auth_events enable row level security;
alter table public.usage_events enable row level security;
alter table public.prompt_logs enable row level security;
alter table public.activity_events enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.profiles,
  public.auth_events,
  public.usage_events,
  public.prompt_logs,
  public.activity_events
  to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

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

-- Connector catalog, per-user Composio links, grants, and CONTEXT.md.
create table if not exists public.connector_catalog (
  toolkit text primary key,
  name text not null,
  description text not null default '',
  logo_url text,
  category text,
  auth_schemes jsonb not null default '[]'::jsonb,
  popular boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.connected_accounts (
  id text primary key,
  workspace_id text not null,
  user_id text not null,
  toolkit text not null,
  toolkit_name text not null,
  composio_account_id text,
  auth_config_id text,
  status text not null default 'disconnected',
  scopes jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, toolkit)
);

create table if not exists public.connector_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  agent_id text not null,
  toolkit text not null,
  granted_by text,
  created_at timestamptz not null default now(),
  unique (agent_id, toolkit)
);

create table if not exists public.workspace_contexts (
  workspace_id text primary key,
  content text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create index if not exists connected_accounts_user_idx
  on public.connected_accounts (workspace_id, user_id);
create index if not exists connector_grants_agent_idx
  on public.connector_grants (agent_id);

alter table public.connector_catalog enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.connector_grants enable row level security;
alter table public.workspace_contexts enable row level security;

grant select, insert, update, delete on table
  public.connector_catalog,
  public.connected_accounts,
  public.connector_grants,
  public.workspace_contexts
  to service_role;
