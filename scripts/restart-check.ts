import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
const [command, runId] = process.argv.slice(2);
const headers: Record<string, string> = process.env.RELAY_API_KEY
  ? { Authorization: 'Bearer ' + process.env.RELAY_API_KEY }
  : {};
async function read(id: string) {
  const response = await fetch(base + '/v1/runs/' + id, { headers });
  if (!response.ok) throw new Error('Run retrieval failed: ' + response.status);
  return response.json();
}
if (command === 'record' && runId) {
  const run = await read(runId);
  assert.equal(run.status, 'awaiting_approval');
  const pending = run.approvals.find((a: any) => a.status === 'pending');
  assert.ok(pending);
  await writeFile(
    '.data/restart-check.json',
    JSON.stringify({
      runId,
      actionId: pending.id,
      contentHash: pending.content_hash,
      activeMs: run.active_ms,
      events: run.events.length,
    }),
  );
  console.log(
    'Recorded pending action. Restart the services, then run: npx tsx scripts/restart-check.ts verify',
  );
} else if (command === 'verify') {
  const before = JSON.parse(await readFile('.data/restart-check.json', 'utf8'));
  const after = await read(before.runId);
  assert.equal(after.status, 'awaiting_approval');
  const pending = after.approvals.find((a: any) => a.id === before.actionId);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.content_hash, before.contentHash);
  assert.equal(after.active_ms, before.activeMs);
  assert.equal(after.events.length, before.events);
  console.log(
    'PASS: run, exact pending action/hash, active execution budget and ordered events survived a full service/database restart.',
  );
} else throw new Error('Use record <runId> or verify. The run must be awaiting approval.');
