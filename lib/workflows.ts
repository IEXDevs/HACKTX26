import { z } from 'zod';
import { pool, tx, type Db } from './db';
import { defaultConfig, agentConfigSchema, HttpError, mode } from './config';
import { currentTreeDefinitionSchema, defaultTree } from './agent-tree';
import { hash, id } from './security';
import { startRunInTx } from './store';

const createSchema = z
  .object({
    name: z.string().min(1).max(150),
    kind: z.enum(['tree', 'agent']),
    task: z.string().max(15000).default(''),
    tree: currentTreeDefinitionSchema.optional(),
    versionId: z.string().optional(),
  })
  .strict();
const editSchema = z
  .object({
    revision: z.number().int().positive(),
    name: z.string().min(1).max(150).optional(),
    task: z.string().max(15000).optional(),
    tree: currentTreeDefinitionSchema.optional(),
    versionId: z.string().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
const keyCheck = (key: string) => {
  if (!key || key.length > 180)
    throw new HttpError(400, 'An Idempotency-Key of 1–180 characters is required');
};
async function ownedVersion(db: Db, workspace: string, versionId: string) {
  const value = (
    await db.query('SELECT * FROM agent_versions WHERE id=$1 AND workspace_id=$2', [
      versionId,
      workspace,
    ])
  ).rows[0];
  if (!value || value.config.workflowKind === 'tree_planner')
    throw new HttpError(404, 'Published agent version not found');
  return value;
}
export async function listWorkflows(workspace: string) {
  return (
    await pool.query(
      `SELECT w.*,
    (SELECT r.id FROM runs r WHERE r.workflow_id=w.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS latest_run_id,
    (SELECT r.status FROM runs r WHERE r.workflow_id=w.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS latest_status,
    (SELECT count(*)::int FROM runs r WHERE r.workflow_id=w.id) AS run_count,
    (SELECT count(*)::int FROM runs r WHERE r.workflow_id=w.id AND r.status IN ('queued','running','awaiting_requirements','awaiting_approval')) AS active_count
    FROM workflow_pages w WHERE w.workspace_id=$1 ORDER BY w.updated_at DESC,w.id`,
      [workspace],
    )
  ).rows;
}
export async function getWorkflow(workspace: string, pageId: string) {
  const page = (
    await pool.query('SELECT * FROM workflow_pages WHERE id=$1 AND workspace_id=$2', [
      pageId,
      workspace,
    ])
  ).rows[0];
  if (!page) throw new HttpError(404, 'Workflow page not found');
  const [runs, version] = await Promise.all([
    pool.query(
      'SELECT id,status,mode,version_id,created_at,active_ms,error FROM runs WHERE workflow_id=$1 AND workspace_id=$2 ORDER BY created_at DESC,id DESC',
      [pageId, workspace],
    ),
    page.version_id
      ? pool.query('SELECT config,version FROM agent_versions WHERE id=$1 AND workspace_id=$2', [
          page.version_id,
          workspace,
        ])
      : Promise.resolve({ rows: [] }),
  ]);
  return { ...page, runs: runs.rows, config: version.rows[0]?.config || null };
}
export async function createWorkflow(workspace: string, value: unknown, key: string) {
  keyCheck(key);
  const body = createSchema.parse(value);
  const requestHash = hash(body);
  return tx(async (db) => {
    await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
    const prior = (
      await db.query(
        "SELECT * FROM idempotency WHERE workspace_id=$1 AND scope='workflow_create' AND key=$2",
        [workspace, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash)
        throw new HttpError(409, 'Idempotency key was used for another page');
      return { id: prior.resource_id, replayed: true };
    }
    const version = body.versionId ? await ownedVersion(db, workspace, body.versionId) : null;
    if (body.kind === 'agent' && !version)
      throw new HttpError(400, 'Select a published library agent');
    const pageId = id('wf');
    await db.query(
      'INSERT INTO workflow_pages(id,workspace_id,name,kind,task,tree,agent_id,version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        pageId,
        workspace,
        body.name,
        body.kind,
        body.task,
        body.kind === 'tree'
          ? body.tree || defaultTree({ muse: defaultConfig.coordinatorModel, gemini: 'retired' })
          : null,
        body.kind === 'agent' ? version.agent_id : null,
        body.kind === 'agent' ? version.id : null,
      ],
    );
    await db.query(
      "INSERT INTO idempotency(workspace_id,scope,key,request_hash,resource_id) VALUES($1,'workflow_create',$2,$3,$4)",
      [workspace, key, requestHash, pageId],
    );
    return { id: pageId, replayed: false };
  });
}
export async function editWorkflow(workspace: string, pageId: string, value: unknown) {
  const body = editSchema.parse(value);
  return tx(async (db) => {
    await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
    const page = (
      await db.query('SELECT * FROM workflow_pages WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
        pageId,
        workspace,
      ])
    ).rows[0];
    if (!page) throw new HttpError(404, 'Workflow page not found');
    if (page.revision !== body.revision)
      throw new HttpError(409, 'This workflow changed in another tab. Reload before saving.');
    if (body.tree && page.kind !== 'tree')
      throw new HttpError(400, 'Only tree pages accept a tree definition');
    if (body.versionId && page.kind !== 'agent')
      throw new HttpError(400, 'Select agent versions on an individual-agent page');
    const version = body.versionId ? await ownedVersion(db, workspace, body.versionId) : null;
    const result = (
      await db.query(
        'UPDATE workflow_pages SET name=$1,task=$2,tree=$3,agent_id=$4,version_id=$5,archived_at=$6,revision=revision+1,updated_at=now() WHERE id=$7 RETURNING *',
        [
          body.name ?? page.name,
          body.task ?? page.task,
          body.tree ?? page.tree,
          version?.agent_id ?? page.agent_id,
          version?.id ?? page.version_id,
          body.archived === undefined ? page.archived_at : body.archived ? new Date() : null,
          pageId,
        ],
      )
    ).rows[0];
    return result;
  });
}
export async function launchWorkflow(
  workspace: string,
  pageId: string,
  value: unknown,
  key: string,
) {
  keyCheck(key);
  const body = z.object({ revision: z.number().int().positive() }).strict().parse(value);
  const requestHash = hash({ pageId, ...body });
  return tx(async (db) => {
    await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
    const prior = (
      await db.query(
        "SELECT * FROM idempotency WHERE workspace_id=$1 AND scope='workflow_launch' AND key=$2",
        [workspace, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash)
        throw new HttpError(409, 'Idempotency key was used for another launch');
      return { id: prior.resource_id, replayed: true };
    }
    const page = (
      await db.query('SELECT * FROM workflow_pages WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
        pageId,
        workspace,
      ])
    ).rows[0];
    if (!page) throw new HttpError(404, 'Workflow page not found');
    if (page.archived_at)
      throw new HttpError(409, 'Restore the archived workflow before running it');
    if (page.revision !== body.revision)
      throw new HttpError(409, 'Workflow changed. Reload before running.');
    if (page.task.trim().length < 10)
      throw new HttpError(400, 'Enter a task with at least 10 characters');
    let versionId = page.version_id;
    let executionKind: 'workflow' | 'completion' = 'workflow';
    if (page.kind === 'tree') {
      const tree = currentTreeDefinitionSchema.parse(page.tree);
      const config = agentConfigSchema.parse({
        ...defaultConfig,
        workflowKind: 'tree',
        tree,
        treeTask: page.task,
        instructions: tree.nodes.find((n) => n.id === 'user')!.instructions,
        outputFormat: 'agent_tree_json',
        readOnly: true,
        tools: [...new Set(tree.nodes.flatMap((n) => n.tools))],
        maxModelCalls: Math.max(5, tree.nodes.length),
        maxToolCalls: 12,
        activeDeadlineSeconds: 360,
      });
      const existingAgent = page.agent_id
        ? (
            await db.query('SELECT workflow_internal FROM agents WHERE id=$1 AND workspace_id=$2', [
              page.agent_id,
              workspace,
            ])
          ).rows[0]
        : null;
      // A workflow draft must never publish changes into a reusable library agent.
      const agentId = existingAgent?.workflow_internal ? page.agent_id : id('agt');
      if (agentId !== page.agent_id)
        await db.query(
          'INSERT INTO agents(id,workspace_id,name,description,draft,workflow_internal) VALUES($1,$2,$3,$4,$5,true)',
          [agentId, workspace, page.name, 'Private configuration for a workflow page.', config],
        );
      const next = (
        await db.query(
          'SELECT COALESCE(max(version),0)+1 AS n FROM agent_versions WHERE agent_id=$1',
          [agentId],
        )
      ).rows[0].n;
      versionId = id('ver');
      await db.query(
        'INSERT INTO agent_versions(id,agent_id,workspace_id,version,config) VALUES($1,$2,$3,$4,$5)',
        [versionId, agentId, workspace, next, config],
      );
      await db.query('UPDATE workflow_pages SET agent_id=$1,version_id=$2 WHERE id=$3', [
        agentId,
        versionId,
        pageId,
      ]);
    } else {
      const selected = await ownedVersion(db, workspace, versionId);
      if (selected.config.readOnly && !selected.config.tree) executionKind = 'completion';
    }
    const run = await startRunInTx(
      db,
      workspace,
      { versionId, input: { brief: page.task }, mode: mode(), workflowId: pageId },
      'page:' + key,
      executionKind,
    );
    await db.query(
      "INSERT INTO idempotency(workspace_id,scope,key,request_hash,resource_id) VALUES($1,'workflow_launch',$2,$3,$4)",
      [workspace, key, requestHash, run.id],
    );
    await db.query('UPDATE workflow_pages SET updated_at=now() WHERE id=$1', [pageId]);
    return run;
  });
}
export async function createLibraryAgent(workspace: string, value: unknown, key: string) {
  keyCheck(key);
  const body = z
    .object({
      name: z.string().min(1).max(150),
      description: z.string().max(500),
      config: agentConfigSchema,
      publish: z.boolean(),
    })
    .strict()
    .parse(value);
  if (body.config.tree) currentTreeDefinitionSchema.parse(body.config.tree);
  if (body.config.tools.includes('org_history') || body.config.extractionProvider !== 'muse')
    throw new HttpError(400, 'Select Meta models and active search tools only');
  const requestHash = hash(body);
  return tx(async (db) => {
    await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
    const prior = (
      await db.query(
        "SELECT * FROM idempotency WHERE workspace_id=$1 AND scope='agent_create' AND key=$2",
        [workspace, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash)
        throw new HttpError(409, 'Idempotency key was used for another agent');
      return { ...JSON.parse(prior.resource_id), replayed: true };
    }
    const agentId = id('agt'),
      versionId = body.publish ? id('ver') : undefined;
    await db.query(
      'INSERT INTO agents(id,workspace_id,name,description,draft) VALUES($1,$2,$3,$4,$5)',
      [agentId, workspace, body.name, body.description, body.config],
    );
    if (versionId)
      await db.query(
        'INSERT INTO agent_versions(id,agent_id,workspace_id,version,config) VALUES($1,$2,$3,1,$4)',
        [versionId, agentId, workspace, body.config],
      );
    const result = { id: agentId, versionId, version: versionId ? 1 : undefined };
    await db.query(
      "INSERT INTO idempotency(workspace_id,scope,key,request_hash,resource_id) VALUES($1,'agent_create',$2,$3,$4)",
      [workspace, key, requestHash, JSON.stringify(result)],
    );
    return result;
  });
}
