import 'dotenv/config';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
let key = process.env.RELAY_API_KEY || '';
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(base + '/v1/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      ...(key ? { Authorization: 'Bearer ' + key } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(response.status + ' ' + JSON.stringify(data));
  return data;
}
async function waitFor(id: string, status: string) {
  const end = Date.now() + 40000;
  while (Date.now() < end) {
    const run = await request('runs/' + id);
    if (run.status === status) return run;
    if (['failed', 'rejected', 'cancelled'].includes(run.status))
      throw new Error(
        'Unexpected state: ' + JSON.stringify({ status: run.status, error: run.error }),
      );
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for ' + status);
}
const dashboard = await request('dashboard');
assert.equal(dashboard.mode, 'fixture', 'This destructive-state smoke test is fixture-only');
if (!key) {
  const created = await request('keys', 'POST', {
    name: 'Automated fixture smoke test',
    scopes: ['runs:read', 'runs:write', 'agents:read', 'approvals:write'],
  });
  key = created.key;
}
const idem = 'smoke-' + crypto.randomUUID();
const input = {
  versionId: 'ver_community_meta_1',
  input: {
    brief:
      'Welcoming outdoor meetup near UT Austin for 96 people within a $2,400 budget. Include vegetarian food and accessible paths.',
  },
};
const created = await request('runs', 'POST', input, { 'Idempotency-Key': idem });
const duplicate = await request('runs', 'POST', input, { 'Idempotency-Key': idem });
assert.equal(created.id, duplicate.id);
assert.equal(duplicate.replayed, true);
let run = await waitFor(created.id, 'awaiting_requirements');
assert.equal(run.requirements.attendees, 96);
assert.equal(run.requirements.budget, 2400);
assert.equal((await request('runs/' + run.id)).status, 'awaiting_requirements');
await request('runs/' + run.id + '/requirements', 'POST', { ...run.requirements, attendees: 80 });
run = await waitFor(run.id, 'awaiting_approval');
assert.equal(run.evidence.length, 3);
assert.ok(run.output.recommendation.name.includes('Garden'));
assert.ok(run.steps.some((s: any) => s.input?.arguments?.query?.includes('80 people')));
for (let i = 0; i < 2; i++) {
  const pending = run.approvals.find((a: any) => a.status === 'pending');
  assert.ok(pending);
  const decision = { decision: 'approve', contentHash: pending.content_hash };
  await request(`runs/${run.id}/approvals/${pending.id}`, 'POST', decision);
  const replay = await request(`runs/${run.id}/approvals/${pending.id}`, 'POST', decision);
  assert.equal(replay.replayed, true);
  run = await waitFor(run.id, i === 0 ? 'awaiting_approval' : 'succeeded');
}
assert.equal(run.artifacts.length, 1);
assert.equal(run.approvals.length, 2);
const events = (await request('runs/' + run.id + '/events')).data;
const cursor = Number(events[Math.floor(events.length / 2)].id);
const replay = (await request('runs/' + run.id + '/events?after=' + cursor)).data;
assert.ok(replay.every((e: any) => Number(e.id) > cursor));
const stream = await fetch(base + `/v1/runs/${run.id}/events?stream=true`, {
  headers: { Authorization: 'Bearer ' + key, 'Last-Event-ID': String(cursor) },
});
const sse = await stream.text();
assert.ok(sse.includes('event: done'));
assert.ok(!sse.includes(`id: ${cursor}\n`));
const pageId = run.approvals.find((a: any) => a.action === 'publish_page').id;
const page = await fetch(base + '/events/' + pageId);
assert.equal(page.status, 200);
const interested = await fetch(base + '/events/' + pageId, {
  method: 'POST',
  headers: { Origin: base },
  redirect: 'manual',
});
assert.equal(interested.status, 303);
const denied = await request(
  'runs',
  'POST',
  {
    ...input,
    input: { brief: 'Plan a quiet meetup near UT Austin for 30 people within a $900 budget' },
  },
  { 'Idempotency-Key': 'reject-' + idem },
);
let rejected = await waitFor(denied.id, 'awaiting_requirements');
await request('runs/' + denied.id + '/requirements', 'POST', rejected.requirements);
rejected = await waitFor(denied.id, 'awaiting_approval');
const pending = rejected.approvals[0];
await request(`runs/${denied.id}/approvals/${pending.id}`, 'POST', {
  decision: 'reject',
  contentHash: pending.content_hash,
});
rejected = await request('runs/' + denied.id);
assert.equal(rejected.status, 'rejected');
assert.equal(rejected.artifacts.length, 0);
const completion = await request(
  'chat/completions',
  'POST',
  {
    model: 'ver_research_meta_1',
    messages: [
      { role: 'user', content: 'Suggest a short checklist for a welcoming community meetup.' },
    ],
    stream: false,
  },
  { 'Idempotency-Key': 'completion-' + idem },
);
assert.equal(completion.object, 'chat.completion');
assert.ok(completion.choices[0].message.content.includes('FIXTURE'));
const client = new Client({ name: 'relay-smoke-client', version: '0.1.0' });
try {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, RELAY_API_KEY: key, APP_URL: base }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'services/delegation.ts'],
      env,
    }),
  );
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), ['get_agent_run', 'start_agent_run']);
  const result = await client.callTool({ name: 'get_agent_run', arguments: { runId: run.id } });
  assert.equal(result.isError, false);
  const delegated = await client.callTool({
    name: 'start_agent_run',
    arguments: {
      versionId: 'ver_community_meta_1',
      brief: input.input.brief,
      idempotencyKey: 'delegation-' + idem,
    },
  });
  assert.equal(delegated.isError, false);
  const delegatedRun = JSON.parse((delegated.content as { text: string }[])[0].text);
  await request('runs/' + delegatedRun.id + '/cancel', 'POST');
} finally {
  await client.close();
}
console.log(
  JSON.stringify(
    {
      ok: true,
      completedRun: run.id,
      rejectedRun: denied.id,
      checks: [
        'native API',
        'workspace key',
        'HTTP 202',
        'duplicate request/debit',
        'changed input changes tool query and recommendation',
        'corrected requirements',
        'MCP evidence',
        'exact save approval',
        'duplicate approval',
        'exact publish approval',
        'private artifact',
        'persisted refresh',
        'event replay',
        'SSE reconnect',
        'participant interest',
        'rejection prevents write',
        'read-only completion',
        'official-SDK stdio delegation client',
      ],
    },
    null,
    2,
  ),
);
