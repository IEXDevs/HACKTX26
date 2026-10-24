CREATE TABLE IF NOT EXISTS api_requests (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id),
 method text NOT NULL, path text NOT NULL, status integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_requests_workspace_time ON api_requests(workspace_id,created_at DESC);
