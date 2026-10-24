import 'dotenv/config';
import { claimRun, processRun, expireApprovals } from '../lib/runtime';
import { pool } from '../lib/db';
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
console.log('Relay worker started. Approval pauses hold no worker lease.');
while (!stopped) {
  try {
    await expireApprovals();
    const run = await claimRun();
    if (run) await processRun(run);
    else await new Promise((r) => setTimeout(r, 500));
  } catch (e) {
    console.error('Worker poll failed:', e instanceof Error ? e.name : 'unknown');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await pool.end();
