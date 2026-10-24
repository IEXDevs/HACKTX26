import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
const key = process.env.RELAY_API_KEY;
if (!key)
  throw new Error(
    'Create a platform key in the API view and set RELAY_API_KEY. The example never prints your key.',
  );
async function request(path: string, method = 'GET', body?: unknown, idem?: string) {
  const response = await fetch(base + '/v1/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...(idem ? { 'Idempotency-Key': idem } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(response.status + ' ' + JSON.stringify(data));
  return data;
}
const rl = createInterface({ input: stdin, output: stdout });
try {
  const brief =
    process.env.DEMO_BRIEF ||
    'Plan a welcoming meetup near UT Austin for 80 people within a $3,000 event budget. Include quiet introductions and vegetarian food.';
  const created = await request(
    'runs',
    'POST',
    { versionId: process.env.RELAY_VERSION_ID || 'ver_community_1', input: { brief } },
    process.env.RELAY_IDEMPOTENCY_KEY || 'api-demo-' + crypto.randomUUID(),
  );
  console.log('Accepted:', created.id);
  console.log('Dashboard:', base + '/?view=runs&run=' + created.id);
  let previous = '';
  while (true) {
    const run = await request('runs/' + created.id);
    if (run.status !== previous) {
      console.log('State:', run.status);
      previous = run.status;
    }
    if (run.status === 'awaiting_requirements') {
      console.log(JSON.stringify(run.requirements, null, 2));
      const answer = await rl.question(
        'Confirm these requirements? Type confirm, or anything else to cancel: ',
      );
      if (answer.trim() !== 'confirm') {
        await request('runs/' + run.id + '/cancel', 'POST');
        break;
      }
      await request('runs/' + run.id + '/requirements', 'POST', run.requirements);
    }
    if (run.status === 'awaiting_approval') {
      const a = run.approvals.find((a: any) => a.status === 'pending');
      console.log(
        'Exact action:',
        a.action,
        '\nAction ID:',
        a.id,
        '\nContent hash:',
        a.content_hash,
      );
      console.log(JSON.stringify(a.content, null, 2));
      const answer = await rl.question(
        'Type approve to authorize this exact action, or reject to prevent it: ',
      );
      await request(`runs/${run.id}/approvals/${a.id}`, 'POST', {
        decision: answer.trim() === 'approve' ? 'approve' : 'reject',
        contentHash: a.content_hash,
      });
    }
    if (['succeeded', 'failed', 'cancelled', 'rejected'].includes(run.status)) {
      console.log(
        JSON.stringify({ status: run.status, error: run.error, output: run.output }, null, 2),
      );
      break;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
} finally {
  rl.close();
}
