import { z } from 'zod';
import { pool } from './db';
export async function diagnostics(workspace: string, rangeValue: string, modeValue: string) {
  const range = z.enum(['24h', '7d', 'all']).parse(rangeValue),
    mode = z.enum(['all', 'live', 'fixture']).parse(modeValue);
  const since =
    range === 'all' ? null : new Date(Date.now() - (range === '24h' ? 86400000 : 604800000));
  const cte = `WITH observations AS (SELECT s.*,r.workflow_id,r.mode,r.status AS run_status,r.error AS run_error,r.version_id,a.id AS agent_id,a.name AS agent_name,COALESCE(w.name,a.name) AS workflow_name,COALESCE(NULLIF(s.input->>'model',''),NULLIF(s.output->>'model',''),'Not reported') AS model FROM steps s JOIN runs r ON r.id=s.run_id JOIN agent_versions v ON v.id=r.version_id JOIN agents a ON a.id=v.agent_id LEFT JOIN workflow_pages w ON w.id=r.workflow_id WHERE r.workspace_id=$1 AND ($2::timestamptz IS NULL OR s.created_at>=$2) AND ($3='all' OR r.mode=$3)) `;
  const args = [workspace, since, mode];
  const [totals, workflows, agents, models, failures] = await Promise.all([
    pool.query(
      cte +
        "SELECT count(*)::int AS steps,count(DISTINCT run_id)::int AS runs,COALESCE(sum(tokens),0)::bigint AS tokens,count(*) FILTER(WHERE status='failed')::int AS failures,COALESCE(round(avg(duration_ms)),0)::int AS avg_ms FROM observations",
      args,
    ),
    pool.query(
      cte +
        "SELECT workflow_id AS id,workflow_name AS name,count(DISTINCT run_id)::int AS runs,count(*)::int AS steps,COALESCE(sum(tokens),0)::bigint AS tokens,count(*) FILTER(WHERE status='failed')::int AS failures,COALESCE(sum(duration_ms),0)::bigint AS duration_ms FROM observations GROUP BY workflow_id,workflow_name ORDER BY tokens DESC,steps DESC",
      args,
    ),
    pool.query(
      cte +
        "SELECT agent_id,CASE WHEN input->>'nodeId' IS NOT NULL THEN name ELSE agent_name END AS name,count(*)::int AS calls,COALESCE(sum(tokens),0)::bigint AS tokens,count(*) FILTER(WHERE status='failed')::int AS failures,COALESCE(round(avg(duration_ms)),0)::int AS avg_ms FROM observations WHERE kind='model' GROUP BY agent_id,CASE WHEN input->>'nodeId' IS NOT NULL THEN name ELSE agent_name END ORDER BY tokens DESC,calls DESC",
      args,
    ),
    pool.query(
      cte +
        "SELECT model,mode,count(*)::int AS calls,COALESCE(sum(tokens),0)::bigint AS tokens,count(*) FILTER(WHERE status='failed')::int AS failures,COALESCE(round(avg(duration_ms)),0)::int AS avg_ms FROM observations WHERE kind='model' GROUP BY model,mode ORDER BY tokens DESC,calls DESC",
      args,
    ),
    pool.query(
      cte +
        "SELECT run_id,workflow_id,workflow_name,name,model,output->>'error' AS error,created_at FROM observations WHERE status='failed' ORDER BY created_at DESC LIMIT 30",
      args,
    ),
  ]);
  return {
    range,
    mode,
    totals: totals.rows[0],
    workflows: workflows.rows,
    agents: agents.rows,
    models: models.rows,
    failures: failures.rows,
  };
}
