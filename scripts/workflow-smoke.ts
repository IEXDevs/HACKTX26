import 'dotenv/config';
import assert from 'node:assert/strict';
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
async function call(path: string, method = 'GET', body?: unknown, key?: string, status = 200) {
  const response = await fetch(base + '/v1/' + path, {
    method,
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, status, `${method} ${path}: ${response.status}`);
  return response.json();
}
const dashboard = await call('dashboard');
assert.equal(dashboard.mode, 'fixture', 'This run/debit smoke test requires explicit fixture mode');
const writer = dashboard.agents.find((a: any) => a.id === 'agt_preset_writer');
assert.ok(writer?.versions[0]);
const token = crypto.randomUUID();
const body = {
  name: 'Fixture UI smoke writer',
  description: 'Labeled local HTTP verification agent.',
  config: writer.draft,
  publish: true,
};
const agent = await call('agents', 'POST', body, 'library-' + token, 201);
assert.equal(
  (await call('agents', 'POST', body, 'library-' + token, 201)).versionId,
  agent.versionId,
);
const page = await call(
  'workflows',
  'POST',
  {
    name: 'Fixture UI smoke workflow',
    kind: 'agent',
    versionId: agent.versionId,
    task: 'Write a concise demonstration greeting.',
  },
  'page-' + token,
  201,
);
const saved = await call('workflows/' + page.id, 'PATCH', {
  revision: 1,
  task: 'Write a welcoming demonstration greeting for first-time participants.',
});
await call('workflows/' + page.id, 'PATCH', { revision: 1, name: 'Stale update' }, undefined, 409);
const launched = await call(
  'workflows/' + page.id + '/runs',
  'POST',
  { revision: saved.revision },
  'launch-' + token,
  202,
);
assert.equal(
  (
    await call(
      'workflows/' + page.id + '/runs',
      'POST',
      { revision: saved.revision },
      'launch-' + token,
      202,
    )
  ).id,
  launched.id,
);
let run: any;
for (let i = 0; i < 100; i++) {
  run = await call('runs/' + launched.id);
  if (run.status === 'succeeded') break;
  assert.ok(!['failed', 'cancelled', 'rejected'].includes(run.status), run.error);
  await new Promise((r) => setTimeout(r, 250));
}
assert.equal(run.status, 'succeeded');
assert.equal(run.workflow_id, page.id);
assert.equal(run.output.results.length, 2);
const archived = await call('workflows/' + page.id, 'PATCH', {
  revision: saved.revision,
  archived: true,
});
await call(
  'workflows/' + page.id + '/runs',
  'POST',
  { revision: archived.revision },
  'archived-' + token,
  409,
);
assert.equal((await call('workflows/' + page.id)).runs[0].id, run.id);
const restored = await call('workflows/' + page.id, 'PATCH', {
  revision: archived.revision,
  archived: false,
});
assert.equal(restored.archived_at, null);
const stats = await call('diagnostics?range=all&mode=fixture');
assert.ok(stats.workflows.some((w: any) => w.id === page.id));
assert.ok(stats.agents.some((a: any) => a.agent_id === agent.id));
assert.ok(stats.models.some((m: any) => m.model === writer.draft.coordinatorModel));
console.log(
  JSON.stringify(
    {
      ok: true,
      page: page.id,
      run: run.id,
      checks: [
        'HTTP library creation',
        'duplicate library publication',
        'persistent workflow page',
        'PATCH draft update',
        'stale update conflict',
        'immutable version execution',
        'duplicate launch and debit',
        'archive and restore',
        'archive prevents a new run',
        'persisted history',
        'workflow/agent/model diagnostics',
      ],
    },
    null,
    2,
  ),
);
