-- Required when the project was created with "Automatically expose new tables" off.
-- Run in the Supabase SQL editor as the postgres role. Without this,
-- service_role cannot write auth_events / usage / prompts and Observability
-- stays empty. Safe to re-run on an existing project.
grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.profiles,
  public.auth_events,
  public.usage_events,
  public.prompt_logs,
  public.activity_events,
  public.connector_catalog,
  public.connected_accounts,
  public.connector_grants,
  public.workspace_contexts
  to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
