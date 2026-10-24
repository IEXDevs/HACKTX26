import 'dotenv/config';
import assert from 'node:assert/strict';
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
let platformKey = '';
let platformKeyId = '';
async function call(path: string, method = 'GET', body?: unknown, key?: string) {
  const response = await fetch(base + '/v1/' + path, {
    method,
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(platformKey ? { Authorization: 'Bearer ' + platformKey } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify({ status: response.status, error: data.error }));
  return { status: response.status, data };
}
async function wait(id: string) {
  for (let i = 0; i < 100; i++) {
    const { data: run } = await call('runs/' + id);
    if (run.status === 'succeeded') return run;
    if (['failed', 'cancelled', 'rejected'].includes(run.status))
      throw new Error(run.error || run.status);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Tree run did not finish before the smoke-test deadline');
}
const { data: dashboard } = await call('dashboard');
assert.equal(dashboard.mode, 'fixture', 'This smoke test is for explicit fixture mode only');
const task =
  'Research and compare accessible community meetup venues near UT Austin for 88 people within a $2800 budget. Use organizational history and preferences, review risks and source evidence, and propose a schedule.';
const plannerKey = 'tree-planner-smoke-' + crypto.randomUUID();
const { data: plan, status } = await call(
  'trees/plan',
  'POST',
  { task, complexity: 'auto', provider: 'muse', model: 'muse-spark-1.3' },
  plannerKey,
);
assert.equal(status, 202);
const { data: planReplay } = await call(
  'trees/plan',
  'POST',
  { task, complexity: 'auto', provider: 'muse', model: 'muse-spark-1.3' },
  plannerKey,
);
assert.equal(plan.id, planReplay.id);
const proposed = await wait(plan.id);
assert.equal(proposed.output.planning.mode, 'fixture');
const tree = proposed.output.tree;
assert.ok(tree.nodes.length >= 5);
tree.nodes.find((n: any) => n.id === 'requirements').name = 'Task requirements specialist';
const previous = dashboard.agents.find(
  (a: any) => a.name === 'Fixture tree smoke team' && a.draft.workflowKind === 'tree',
);
const payload = {
  name: 'Fixture tree smoke team',
  task,
  tree,
  publish: true,
  ...(previous ? { agentId: previous.id } : {}),
};
const saveKey = 'tree-save-smoke-' + crypto.randomUUID();
const { data: saved } = await call('trees', 'POST', payload, saveKey);
const { data: again } = await call('trees', 'POST', payload, saveKey);
assert.equal(saved.versionId, again.versionId);
try {
  const { data: key } = await call('keys', 'POST', {
    name: 'Temporary tree smoke client',
    scopes: ['runs:read', 'runs:write', 'agents:read'],
  });
  platformKey = key.key;
  platformKeyId = key.id;
  const runKey = 'tree-execution-smoke-' + crypto.randomUUID();
  const request = { versionId: saved.versionId, input: { brief: task } };
  const { data: started, status } = await call('runs', 'POST', request, runKey);
  assert.equal(status, 202);
  const { data: replayed } = await call('runs', 'POST', request, runKey);
  assert.equal(started.id, replayed.id);
  const run = await wait(started.id);
  assert.equal(run.output.kind, 'agent_tree');
  assert.equal(run.output.results.length, tree.nodes.length);
  assert.equal(run.output.results.at(-1).nodeId, 'user');
  assert.equal(run.evidence.length, 6);
  assert.equal(run.approvals.length, 0);
  assert.equal(run.artifacts.length, 0);
  assert.ok(
    run.steps
      .find((s: any) => s.input?.tool === 'venue_search')
      .input.arguments.query.includes('88 people'),
  );
  const { data: refreshed } = await call('runs/' + run.id);
  assert.deepEqual(refreshed.config.tree, tree);
  assert.equal(refreshed.status, 'succeeded');
  console.log(
    JSON.stringify(
      {
        ok: true,
        plannerRun: plan.id,
        treeAgent: saved.id,
        versionId: saved.versionId,
        completedRun: run.id,
        agents: tree.nodes.length,
        checks: [
          'adaptive fixture planning',
          'duplicate planner request',
          'manual node edit',
          'immutable tree publication',
          'duplicate publication',
          'scoped native API key',
          'duplicate run/debit',
          'per-node model execution',
          'MCP source evidence',
          'orchestrator synthesis',
          'refresh persistence',
          'no write actions',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (platformKeyId) await call('keys/' + platformKeyId, 'DELETE');
}
