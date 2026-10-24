import { z } from 'zod';
import { agentConfigSchema, defaultConfig, HttpError } from './config';
import { currentTreeDefinitionSchema } from './agent-tree';
import { hash, id } from './security';
import { tx } from './db';

export const saveTreeSchema = z
  .object({
    name: z.string().min(1).max(150),
    task: z.string().min(10).max(15000),
    tree: currentTreeDefinitionSchema,
    agentId: z.string().optional(),
    publish: z.boolean(),
  })
  .strict();
export async function saveTree(workspace: string, value: unknown, key: string) {
  const body = saveTreeSchema.parse(value);
  if (!key || key.length > 200)
    throw new HttpError(400, 'An Idempotency-Key is required to save a tree');
  const requestHash = hash(body);
  return tx(async (db) => {
    await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
    const prior = (
      await db.query(
        "SELECT * FROM idempotency WHERE workspace_id=$1 AND scope='tree_save' AND key=$2",
        [workspace, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash)
        throw new HttpError(409, 'Idempotency key was used for another tree');
      const parsed = JSON.parse(prior.resource_id);
      return { ...parsed, replayed: true };
    }
    const agentId = body.agentId || id('agt');
    const config = agentConfigSchema.parse({
      ...defaultConfig,
      instructions: body.tree.nodes.find((n) => n.id === 'user')!.instructions,
      workflowKind: 'tree',
      tree: body.tree,
      treeTask: body.task,
      outputFormat: 'agent_tree_json',
      readOnly: true,
      tools: [...new Set(body.tree.nodes.flatMap((n) => n.tools))],
      maxModelCalls: Math.max(5, body.tree.nodes.length),
      maxToolCalls: 12,
      activeDeadlineSeconds: 360,
    });
    if (body.agentId) {
      const existing = (
        await db.query('SELECT * FROM agents WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
          agentId,
          workspace,
        ])
      ).rows[0];
      if (!existing) throw new HttpError(404, 'Tree agent not found');
      if (existing.draft.workflowKind !== 'tree')
        throw new HttpError(409, 'Use a tree agent for this editor');
      await db.query('UPDATE agents SET name=$1,description=$2,draft=$3 WHERE id=$4', [
        body.name,
        'A reusable, bounded team of specialist agents.',
        config,
        agentId,
      ]);
    } else
      await db.query(
        'INSERT INTO agents(id,workspace_id,name,description,draft) VALUES($1,$2,$3,$4,$5)',
        [agentId, workspace, body.name, 'A reusable, bounded team of specialist agents.', config],
      );
    const result: { id: string; versionId?: string; version?: number; replayed: boolean } = {
      id: agentId,
      replayed: false,
    };
    if (body.publish) {
      result.version = (
        await db.query(
          'SELECT COALESCE(max(version),0)+1 AS next FROM agent_versions WHERE agent_id=$1',
          [agentId],
        )
      ).rows[0].next;
      result.versionId = id('ver');
      await db.query(
        'INSERT INTO agent_versions(id,agent_id,workspace_id,version,config) VALUES($1,$2,$3,$4,$5)',
        [result.versionId, agentId, workspace, result.version, config],
      );
    }
    await db.query(
      "INSERT INTO idempotency(workspace_id,scope,key,request_hash,resource_id) VALUES($1,'tree_save',$2,$3,$4)",
      [workspace, key, requestHash, JSON.stringify(result)],
    );
    return result;
  });
}
export async function plannerVersion(
  workspace: string,
  complexity: 'auto' | 'simple' | 'standard' | 'complex',
  provider: 'muse' | 'gemini',
  model: string,
) {
  if (provider !== 'muse') throw new HttpError(400, 'Only Meta models are active.');
  const suffix = hash({ workspace, complexity, provider, model, profile: 'meta-serp-v1' }).slice(
    0,
    20,
  );
  const agentId = 'agt_architect_' + suffix,
    versionId = 'ver_architect_' + suffix;
  const config = agentConfigSchema.parse({
    ...defaultConfig,
    workflowKind: 'tree_planner',
    treeComplexity: complexity,
    instructions:
      'Design a small specialist agent tree for the user task. Adapt the size and depth to difficulty and uncertainty. The user/orchestrator root must own the task. Use no more than nine nodes, five levels, or twelve read-tool calls. Every node must use provider muse and the selected Meta model. Nodes can only generate text or use the approved SerpAPI venue_search read tool. Do not claim execution, file changes, purchases, or other writes.',
    coordinatorModel: model,
    extractionModel: model,
    outputFormat: 'agent_tree_json',
    readOnly: true,
    tools: [],
    treePlannerProvider: provider,
  });
  await tx(async (db) => {
    await db.query(
      'INSERT INTO agents(id,workspace_id,name,description,draft) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [agentId, workspace, 'Adaptive tree architect', 'Internal task-complexity planner.', config],
    );
    await db.query(
      'INSERT INTO agent_versions(id,agent_id,workspace_id,version,config) VALUES($1,$2,$3,1,$4) ON CONFLICT DO NOTHING',
      [versionId, agentId, workspace, config],
    );
  });
  return versionId;
}
