ALTER TABLE agents ADD COLUMN IF NOT EXISTS workflow_internal boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS agents_workspace_identity ON agents(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS versions_workspace_identity ON agent_versions(workspace_id,id);
CREATE TABLE workflow_pages (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id),
 name text NOT NULL, kind text NOT NULL CHECK(kind IN ('tree','agent')),
 task text NOT NULL DEFAULT '', tree jsonb, agent_id text, version_id text,
 revision integer NOT NULL DEFAULT 1, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,agent_id) REFERENCES agents(workspace_id,id),
 FOREIGN KEY(workspace_id,version_id) REFERENCES agent_versions(workspace_id,id)
);
ALTER TABLE runs ADD COLUMN workflow_id text;
ALTER TABLE runs ADD CONSTRAINT run_workflow_workspace FOREIGN KEY(workspace_id,workflow_id) REFERENCES workflow_pages(workspace_id,id);
CREATE INDEX workflow_page_runs ON runs(workspace_id,workflow_id,created_at DESC);
INSERT INTO workflow_pages(id,workspace_id,name,kind,task,tree,agent_id,version_id)
SELECT 'wf_'||a.id,a.workspace_id,a.name,
 CASE WHEN a.draft->'tree' IS NOT NULL THEN 'tree' ELSE 'agent' END,
 COALESCE((SELECT r.input->>'brief' FROM runs r JOIN agent_versions v ON v.id=r.version_id WHERE v.agent_id=a.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1),a.draft->>'treeTask',''),
 a.draft->'tree',a.id,
 (SELECT v.id FROM agent_versions v WHERE v.agent_id=a.id ORDER BY v.version DESC LIMIT 1)
FROM agents a WHERE COALESCE(a.draft->>'workflowKind','')<>'tree_planner'
 AND (a.draft->'tree' IS NOT NULL OR EXISTS(SELECT 1 FROM runs r JOIN agent_versions v ON v.id=r.version_id WHERE v.agent_id=a.id))
ON CONFLICT DO NOTHING;
UPDATE runs r SET workflow_id=w.id FROM agent_versions v,workflow_pages w
WHERE r.version_id=v.id AND w.agent_id=v.agent_id AND w.workspace_id=r.workspace_id;
