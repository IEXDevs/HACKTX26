import { pool, tx, type Db } from './db';
import { agentConfigSchema, requirementsSchema, HttpError, type AgentConfig } from './config';
import { hash, id, redact } from './security';

export async function emit(
  db: Db,
  runId: string,
  workspace: string,
  kind: string,
  stepId: string,
  data: unknown,
) {
  await db.query(
    'INSERT INTO run_events(run_id,workspace_id,kind,step_id,data) VALUES($1,$2,$3,$4,$5)',
    [runId, workspace, kind, stepId, redact(data)],
  );
}
export async function version(workspace: string, versionId: string) {
  const r = await pool.query('SELECT * FROM agent_versions WHERE id=$1 AND workspace_id=$2', [
    versionId,
    workspace,
  ]);
  if (!r.rows[0]) throw new HttpError(404, 'Published agent version not found');
  return r.rows[0];
}
export async function startRun(
  workspace: string,
  body: {
    versionId: string;
    input: { brief: string; fileId?: string };
    mode: 'fixture' | 'live';
    workflowId?: string;
  },
  key: string,
  kind: 'workflow' | 'completion' = 'workflow',
) {
  return tx((db) => startRunInTx(db, workspace, body, key, kind));
}
export async function startRunInTx(
  db: Db,
  workspace: string,
  body: {
    versionId: string;
    input: { brief: string; fileId?: string };
    mode: 'fixture' | 'live';
    workflowId?: string;
  },
  key: string,
  kind: 'workflow' | 'completion' = 'workflow',
) {
  if (!key || key.length > 200)
    throw new HttpError(400, 'An Idempotency-Key of 1–200 characters is required');
  const requestHash = hash({ body, kind });
  await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
  const prior = await db.query(
    "SELECT * FROM idempotency WHERE workspace_id=$1 AND scope='runs' AND key=$2",
    [workspace, key],
  );
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== requestHash)
      throw new HttpError(409, 'Idempotency key was already used for different content');
    return { id: prior.rows[0].resource_id as string, replayed: true };
  }
  const v = await db.query('SELECT * FROM agent_versions WHERE id=$1 AND workspace_id=$2', [
    body.versionId,
    workspace,
  ]);
  if (!v.rows[0]) throw new HttpError(404, 'Published agent version not found');
  if (
    body.input.fileId &&
    !(
      await db.query('SELECT 1 FROM input_files WHERE id=$1 AND workspace_id=$2', [
        body.input.fileId,
        workspace,
      ])
    ).rowCount
  )
    throw new HttpError(404, 'Input file not found');
  let workflowId = body.workflowId || null;
  if (workflowId) {
    const page = (
      await db.query('SELECT * FROM workflow_pages WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
        workflowId,
        workspace,
      ])
    ).rows[0];
    if (!page) throw new HttpError(404, 'Workflow page not found');
    if (page.archived_at)
      throw new HttpError(409, 'Restore the archived workflow before running it');
  } else if (v.rows[0].config.workflowKind !== 'tree_planner') {
    workflowId = 'wf_' + v.rows[0].agent_id;
    await db.query(
      'INSERT INTO workflow_pages(id,workspace_id,name,kind,task,tree,agent_id,version_id) SELECT $1,$2,a.name,$3,$4,$5,a.id,$6 FROM agents a WHERE a.id=$7 AND a.workspace_id=$2 ON CONFLICT DO NOTHING',
      [
        workflowId,
        workspace,
        v.rows[0].config.tree ? 'tree' : 'agent',
        body.input.brief,
        v.rows[0].config.tree || null,
        body.versionId,
        v.rows[0].agent_id,
      ],
    );
    const page = (
      await db.query(
        'SELECT archived_at FROM workflow_pages WHERE id=$1 AND workspace_id=$2 FOR UPDATE',
        [workflowId, workspace],
      )
    ).rows[0];
    if (page?.archived_at)
      throw new HttpError(409, 'Restore the archived workflow before running it');
  }
  const balance = await db.query(
    'SELECT COALESCE(sum(delta),0)::int AS balance FROM credit_ledger WHERE workspace_id=$1',
    [workspace],
  );
  if (balance.rows[0].balance < 1) throw new HttpError(402, 'Insufficient test credits');
  const runId = id('run');
  await db.query(
    'INSERT INTO runs(id,workspace_id,version_id,status,mode,input,checkpoint,workflow_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      runId,
      workspace,
      body.versionId,
      'queued',
      body.mode,
      body.input,
      { phase: 'extract', completion: kind === 'completion' },
      workflowId,
    ],
  );
  await db.query(
    'INSERT INTO credit_ledger(id,workspace_id,delta,reason,reference) VALUES($1,$2,-1,$3,$4)',
    [id('ledger'), workspace, 'Run reservation: one test credit', 'run:' + runId],
  );
  await db.query(
    "INSERT INTO idempotency(workspace_id,scope,key,request_hash,resource_id) VALUES($1,'runs',$2,$3,$4)",
    [workspace, key, requestHash, runId],
  );
  await emit(db, runId, workspace, 'run.queued', 'user', {
    summary: 'Run accepted. Published version pinned.',
    versionId: body.versionId,
    mode: body.mode,
    input: body.input,
  });
  return { id: runId, replayed: false };
}
export async function getRun(workspace: string, runId: string) {
  const result = await pool.query(
    'SELECT r.*,a.name AS agent_name,v.version AS version_number,v.config FROM runs r JOIN agent_versions v ON v.id=r.version_id JOIN agents a ON a.id=v.agent_id WHERE r.id=$1 AND r.workspace_id=$2',
    [runId, workspace],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'Run not found');
  const [steps, approvals, events, artifacts] = await Promise.all([
    pool.query('SELECT * FROM steps WHERE run_id=$1 ORDER BY created_at,id', [runId]),
    pool.query('SELECT * FROM approvals WHERE run_id=$1 ORDER BY expires_at,id', [runId]),
    pool.query('SELECT * FROM run_events WHERE run_id=$1 ORDER BY id', [runId]),
    pool.query('SELECT * FROM artifacts WHERE run_id=$1', [runId]),
  ]);
  const { checkpoint, lease_token, lease_until, ...visible } = row;
  return {
    ...visible,
    input: redact(visible.input),
    steps: steps.rows,
    approvals: approvals.rows,
    events: events.rows,
    artifacts: artifacts.rows,
    evidence: checkpoint.evidence || [],
  };
}
export async function reviewRequirements(workspace: string, runId: string, requirements: unknown) {
  const parsed = requirementsSchema.parse(requirements);
  return tx(async (db) => {
    const r = await db.query('SELECT * FROM runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
      runId,
      workspace,
    ]);
    const run = r.rows[0];
    if (!run) throw new HttpError(404, 'Run not found');
    if (run.status !== 'awaiting_requirements')
      throw new HttpError(409, 'This run is not waiting for requirements');
    await db.query(
      "UPDATE runs SET requirements=$1,status='queued',checkpoint=$2,updated_at=now() WHERE id=$3",
      [parsed, { ...run.checkpoint, phase: 'research' }, runId],
    );
    await emit(db, runId, workspace, 'requirements.confirmed', 'review', {
      summary: 'Organizer confirmed the exact requirements.',
      requirements: parsed,
    });
    return { ok: true };
  });
}
export async function decideApproval(
  workspace: string,
  runId: string,
  actionId: string,
  decision: 'approve' | 'reject',
  contentHash: string,
) {
  const result = await tx(async (db) => {
    const r = await db.query('SELECT * FROM runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
      runId,
      workspace,
    ]);
    const run = r.rows[0];
    if (!run) throw new HttpError(404, 'Run not found');
    const a = (
      await db.query('SELECT * FROM approvals WHERE id=$1 AND run_id=$2 FOR UPDATE', [
        actionId,
        runId,
      ])
    ).rows[0];
    if (!a) throw new HttpError(404, 'Pending action not found');
    if (a.content_hash !== contentHash)
      throw new HttpError(409, 'Content hash does not match the exact proposed action');
    if (a.status !== 'pending') {
      if (a.status === (decision === 'approve' ? 'approved' : 'rejected'))
        return { ok: true, replayed: true };
      throw new HttpError(409, 'This action already has a different decision');
    }
    if (new Date(a.expires_at).getTime() < Date.now()) {
      await db.query("UPDATE approvals SET status='expired',decided_at=now() WHERE id=$1", [
        actionId,
      ]);
      await db.query(
        "UPDATE runs SET status='failed',error='Approval expired',updated_at=now() WHERE id=$1",
        [runId],
      );
      await emit(db, runId, workspace, 'approval.expired', actionId, {
        summary: 'Approval expired. No write was authorized.',
      });
      return { expired: true };
    }
    if (run.status !== 'awaiting_approval')
      throw new HttpError(409, 'Run is not waiting for this action');
    await db.query('UPDATE approvals SET status=$1,decided_at=now() WHERE id=$2', [
      decision === 'approve' ? 'approved' : 'rejected',
      actionId,
    ]);
    await db.query('UPDATE runs SET status=$1,updated_at=now() WHERE id=$2', [
      decision === 'approve' ? 'queued' : 'rejected',
      runId,
    ]);
    await emit(
      db,
      runId,
      workspace,
      'approval.' + (decision === 'approve' ? 'approved' : 'rejected'),
      actionId,
      {
        summary:
          decision === 'approve'
            ? 'Exact action approved. Run queued to continue.'
            : 'Action rejected. Write prevented.',
        contentHash,
      },
    );
    return { ok: true, replayed: false };
  });
  if (result.expired) throw new HttpError(410, 'Approval expired');
  return result;
}
export async function cancelRun(workspace: string, runId: string) {
  return tx(async (db) => {
    const run = (
      await db.query('SELECT * FROM runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
        runId,
        workspace,
      ])
    ).rows[0];
    if (!run) throw new HttpError(404, 'Run not found');
    if (['succeeded', 'failed', 'rejected', 'cancelled'].includes(run.status))
      return { status: run.status };
    await db.query(
      "UPDATE runs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
      [runId],
    );
    await db.query(
      "UPDATE approvals SET status='rejected',decided_at=now() WHERE run_id=$1 AND status='pending'",
      [runId],
    );
    await emit(db, runId, workspace, 'run.cancelled', 'user', {
      summary: 'Run cancelled. No further actions will start.',
    });
    return { status: 'cancelled' };
  });
}
export async function saveAgent(
  workspace: string,
  agentId: string,
  name: string,
  description: string,
  config: unknown,
  publish: boolean,
) {
  const parsed = agentConfigSchema.parse(config);
  if (
    parsed.tools.includes('org_history') ||
    (parsed.tree && parsed.tree.nodes.some((n) => n.provider !== 'muse')) ||
    (!parsed.tree && parsed.extractionProvider !== 'muse')
  )
    throw new HttpError(
      400,
      'Publish a Meta-only configuration with SerpAPI search. Legacy providers are deferred.',
    );
  return tx(async (db) => {
    const a = (
      await db.query('SELECT * FROM agents WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
        agentId,
        workspace,
      ])
    ).rows[0];
    if (!a) throw new HttpError(404, 'Agent not found');
    await db.query('UPDATE agents SET name=$1,description=$2,draft=$3 WHERE id=$4', [
      name,
      description,
      parsed,
      agentId,
    ]);
    if (!publish) return { id: agentId };
    const n = (
      await db.query(
        'SELECT COALESCE(max(version),0)+1 AS next FROM agent_versions WHERE agent_id=$1',
        [agentId],
      )
    ).rows[0].next;
    const versionId = id('ver');
    await db.query(
      'INSERT INTO agent_versions(id,agent_id,workspace_id,version,config) VALUES($1,$2,$3,$4,$5)',
      [versionId, agentId, workspace, n, parsed],
    );
    return { id: agentId, versionId, version: n };
  });
}
export async function duplicateAgent(workspace: string, agentId: string) {
  const a = (
    await pool.query('SELECT * FROM agents WHERE id=$1 AND workspace_id=$2', [agentId, workspace])
  ).rows[0];
  if (!a) throw new HttpError(404, 'Agent not found');
  const newId = id('agt');
  await pool.query(
    'INSERT INTO agents(id,workspace_id,name,description,draft) VALUES($1,$2,$3,$4,$5)',
    [newId, workspace, a.name + ' (copy)', a.description, a.draft],
  );
  return { id: newId };
}
export async function usage(workspace: string) {
  const bucket =
    process.env.TIMESCALE_ENABLED === 'true'
      ? "time_bucket('1 hour',time)"
      : "date_trunc('hour',time)";
  const [chart, totals, balance, receipts] = await Promise.all([
    pool.query(
      `SELECT ${bucket} AS bucket,count(*)::int AS steps,sum(tokens)::int AS tokens,round(avg(duration_ms))::int AS duration_ms FROM execution_metrics WHERE workspace_id=$1 AND time>now()-interval '24 hours' GROUP BY 1 ORDER BY 1`,
      [workspace],
    ),
    pool.query(
      'SELECT count(*)::int AS steps,COALESCE(sum(tokens),0)::int AS tokens,COALESCE(sum(estimated_usd),0) AS estimated_usd FROM execution_metrics WHERE workspace_id=$1',
      [workspace],
    ),
    pool.query(
      'SELECT COALESCE(sum(delta),0)::int AS balance FROM credit_ledger WHERE workspace_id=$1',
      [workspace],
    ),
    pool.query(
      'SELECT id,delta,reason,reference,created_at FROM credit_ledger WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 30',
      [workspace],
    ),
  ]);
  return {
    chart: chart.rows,
    totals: totals.rows[0],
    balance: balance.rows[0].balance,
    receipts: receipts.rows,
    query: bucket,
    pricingConfigured:
      Number(process.env.MODEL_INPUT_USD_PER_MILLION) > 0 ||
      Number(process.env.MODEL_OUTPUT_USD_PER_MILLION) > 0,
  };
}
export type RunConfig = AgentConfig;
