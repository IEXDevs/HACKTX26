CREATE TABLE IF NOT EXISTS workspaces (
 id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agents (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL,
 description text NOT NULL, draft jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_versions (
 id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id), workspace_id text NOT NULL REFERENCES workspaces(id),
 version integer NOT NULL, config jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(agent_id,version)
);
CREATE OR REPLACE FUNCTION relay_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published versions are immutable'; END $$;
DROP TRIGGER IF EXISTS immutable_version ON agent_versions;
CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE ON agent_versions FOR EACH ROW EXECUTE FUNCTION relay_immutable();
CREATE TABLE IF NOT EXISTS api_keys (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL,
 key_hash text NOT NULL UNIQUE, prefix text NOT NULL, scopes text[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS runs (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), version_id text NOT NULL REFERENCES agent_versions(id),
 status text NOT NULL CHECK(status IN ('queued','running','awaiting_requirements','awaiting_approval','succeeded','failed','rejected','cancelled')),
 mode text NOT NULL CHECK(mode IN ('live','fixture')), input jsonb NOT NULL, requirements jsonb,
 output jsonb, checkpoint jsonb NOT NULL DEFAULT '{"phase":"extract"}', error text,
 active_ms bigint NOT NULL DEFAULT 0, lease_token text, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_queue ON runs(status,lease_until,created_at);
CREATE TABLE IF NOT EXISTS idempotency (
 workspace_id text NOT NULL REFERENCES workspaces(id), scope text NOT NULL, key text NOT NULL,
 request_hash text NOT NULL, resource_id text NOT NULL, PRIMARY KEY(workspace_id,scope,key)
);
CREATE TABLE IF NOT EXISTS run_events (
 id bigserial PRIMARY KEY, run_id text NOT NULL REFERENCES runs(id), workspace_id text NOT NULL REFERENCES workspaces(id),
 kind text NOT NULL, step_id text NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_replay ON run_events(run_id,id);
CREATE TABLE IF NOT EXISTS steps (
 run_id text NOT NULL REFERENCES runs(id), id text NOT NULL, name text NOT NULL, kind text NOT NULL,
 parent_id text NOT NULL DEFAULT 'user', status text NOT NULL,
 input jsonb, output jsonb, duration_ms integer, tokens integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,id)
);
CREATE TABLE IF NOT EXISTS approvals (
 id text PRIMARY KEY, run_id text NOT NULL REFERENCES runs(id), workspace_id text NOT NULL REFERENCES workspaces(id),
 action text NOT NULL CHECK(action IN ('save_brief','publish_page')), content jsonb NOT NULL,
 content_hash text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired')),
 expires_at timestamptz NOT NULL, decided_at timestamptz, UNIQUE(run_id,action)
);
CREATE OR REPLACE FUNCTION relay_approval_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash <> OLD.content_hash OR NEW.action <> OLD.action
 OR NEW.run_id <> OLD.run_id OR NEW.workspace_id <> OLD.workspace_id OR NEW.expires_at <> OLD.expires_at THEN
 RAISE EXCEPTION 'Approval action and content are immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_approval ON approvals;
CREATE TRIGGER immutable_approval BEFORE UPDATE ON approvals FOR EACH ROW EXECUTE FUNCTION relay_approval_content();
CREATE TABLE IF NOT EXISTS artifacts (
 action_id text PRIMARY KEY REFERENCES approvals(id), run_id text NOT NULL REFERENCES runs(id),
 workspace_id text NOT NULL, uri text NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS input_files (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), uri text NOT NULL,
 mime_type text NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS event_pages (
 id text PRIMARY KEY REFERENCES approvals(id), workspace_id text NOT NULL, run_id text NOT NULL REFERENCES runs(id),
 content jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS interests (
 page_id text NOT NULL REFERENCES event_pages(id), participant_id text NOT NULL,
 label text NOT NULL DEFAULT 'Demonstration participant', created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(page_id,participant_id)
);
CREATE TABLE IF NOT EXISTS credit_invoices (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), recipient text NOT NULL,
 payer text NOT NULL, lamports bigint NOT NULL, credits integer NOT NULL, network text NOT NULL CHECK(network='devnet'),
 status text NOT NULL DEFAULT 'pending', signature text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_ledger (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), delta integer NOT NULL,
 reason text NOT NULL, reference text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS execution_metrics (
 time timestamptz NOT NULL DEFAULT now(), id text NOT NULL, workspace_id text NOT NULL, run_id text NOT NULL,
 kind text NOT NULL, duration_ms integer NOT NULL, tokens integer NOT NULL DEFAULT 0,
 estimated_usd double precision NOT NULL DEFAULT 0, mode text NOT NULL, PRIMARY KEY(time,id)
);
CREATE INDEX IF NOT EXISTS metrics_workspace_time ON execution_metrics(workspace_id,time DESC);
