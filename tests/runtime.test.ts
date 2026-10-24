import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';

let database: PGlite;
let socket: PGLiteSocketServer;
let connector: ChildProcess;
let db: typeof import('../lib/db');
let store: typeof import('../lib/store');
let runtime: typeof import('../lib/runtime');
let payments: typeof import('../lib/payments');
const ws = 'hacktx-test';
let key = 0;
const input = (brief = 'Meetup near UT Austin for 80 people within a $3,000 budget') => ({
  versionId: 'ver_community_1',
  input: { brief },
  mode: 'fixture' as const,
});
async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}
async function tick() {
  const run = await runtime.claimRun();
  if (run) await runtime.processRun(run);
  return run;
}
async function advance(id: string, target: string) {
  for (let i = 0; i < 20; i++) {
    const run = await store.getRun(ws, id);
    if (run.status === target) return run;
    if (run.status === 'failed') throw new Error(run.error);
    await tick();
  }
  throw new Error('Expected ' + target);
}
async function proposed() {
  const r = await store.startRun(ws, input(), 'test-' + ++key);
  const run = await advance(r.id, 'awaiting_requirements');
  await store.reviewRequirements(ws, r.id, run.requirements);
  return advance(r.id, 'awaiting_approval');
}
beforeAll(async () => {
  const [port, connectorPort] = await Promise.all([freePort(), freePort()]);
  process.env.DATABASE_URL = `postgres://relay:relay@127.0.0.1:${port}/relay`;
  process.env.RELAY_LOCAL_DB = 'true';
  process.env.WORKSPACE_ID = ws;
  process.env.RELAY_MODE = 'fixture';
  process.env.CONNECTOR_SECRET = 'isolated-test-connector-secret-at-least-32';
  process.env.CONNECTOR_URL = `http://127.0.0.1:${connectorPort}/mcp`;
  database = await PGlite.create();
  socket = new PGLiteSocketServer({ db: database, host: '127.0.0.1', port });
  await socket.start();
  db = await import('../lib/db');
  store = await import('../lib/store');
  runtime = await import('../lib/runtime');
  payments = await import('../lib/payments');
  await (await import('../scripts/migrate')).migrate();
  await (await import('../scripts/seed')).seed();
  connector = spawn(process.execPath, ['--import', 'tsx', 'services/connectors.ts'], {
    env: { ...process.env, CONNECTOR_PORT: String(connectorPort) },
    stdio: 'pipe',
    windowsHide: true,
  });
  for (let n = 0; n < 80; n++) {
    try {
      const response = await fetch(`http://127.0.0.1:${connectorPort}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Test MCP connector did not start');
});
afterAll(async () => {
  connector?.kill();
  await db?.pool.end();
  await socket?.stop();
  await database?.close();
});
describe('durable runtime and real MCP transport', () => {
  it('pins immutable versions and duplicates configurations without publishing the copy', async () => {
    await expect(
      db.pool.query("UPDATE agent_versions SET config='{}' WHERE id='ver_community_1'"),
    ).rejects.toThrow('immutable');
    const copy = await store.duplicateAgent(ws, 'agt_community');
    const row = (await db.pool.query('SELECT * FROM agents WHERE id=$1', [copy.id])).rows[0];
    expect(row.draft.tools).toContain('venue_search');
    expect(
      (await db.pool.query('SELECT count(*) AS n FROM agent_versions WHERE agent_id=$1', [copy.id]))
        .rows[0].n,
    ).toBe('0');
    const published = await store.saveAgent(
      ws,
      copy.id,
      row.name,
      row.description,
      {
        ...row.draft,
        instructions:
          'Only research outdoor community events. Keep unknown venue facts unresolved.',
      },
      true,
    );
    expect(published).toHaveProperty('versionId');
  });
  it('serializes duplicate requests and debits exactly once; different content conflicts', async () => {
    const idem = 'duplicate-' + ++key;
    const [a, b] = await Promise.all([
      store.startRun(ws, input(), idem),
      store.startRun(ws, input(), idem),
    ]);
    expect(a.id).toBe(b.id);
    expect(
      (
        await db.pool.query('SELECT count(*) AS n FROM credit_ledger WHERE reference=$1', [
          'run:' + a.id,
        ])
      ).rows[0].n,
    ).toBe('1');
    await expect(
      store.startRun(ws, input('Meetup for 12 people with a $100 budget'), idem),
    ).rejects.toThrow('different content');
    await store.cancelRun(ws, a.id);
  });
  it('persists requirements, enforces workspace ownership, and rejects unconfirmed writes', async () => {
    const r = await store.startRun(ws, input(), 'review-' + ++key);
    const run = await advance(r.id, 'awaiting_requirements');
    expect(run.requirements.attendees).toBe(80);
    await expect(store.getRun('other-workspace', r.id)).rejects.toThrow('not found');
    const raw = (
      await db.pool.query('SELECT lease_token,lease_until FROM runs WHERE id=$1', [r.id])
    ).rows[0];
    expect(raw.lease_token).toBeNull();
    expect(raw.lease_until).toBeNull();
    expect(
      (await db.pool.query('SELECT count(*) AS n FROM artifacts WHERE run_id=$1', [r.id])).rows[0]
        .n,
    ).toBe('0');
    await store.cancelRun(ws, r.id);
  });
  it('produces evidence through official-SDK MCP and changes recommendations with corrected input', async () => {
    const r = await store.startRun(ws, input(), 'changed-' + ++key);
    const run = await advance(r.id, 'awaiting_requirements');
    await store.reviewRequirements(ws, r.id, {
      ...run.requirements,
      attendees: 120,
      budget: 1800,
      preferences: ['outdoor', 'vegetarian'],
    });
    const p = await advance(r.id, 'awaiting_approval');
    expect(p.evidence).toHaveLength(6);
    expect(p.evidence.every((e: any) => e.fixture)).toBe(true);
    expect(p.output.recommendation.name).toContain('Garden');
    expect(
      p.steps.some((s: any) => s.input?.arguments?.query?.includes('120 people budget $1800')),
    ).toBe(true);
    expect(p.output.budget.reduce((n: number, b: any) => n + b.estimatedUsd, 0)).toBe(1800);
    await store.cancelRun(ws, r.id);
  });
  it('binds approval to exact immutable content; duplicate decisions recover one artifact', async () => {
    let run = await proposed();
    const a = run.approvals[0];
    await expect(store.decideApproval(ws, run.id, a.id, 'approve', '0'.repeat(64))).rejects.toThrow(
      'hash',
    );
    await expect(
      db.pool.query("UPDATE approvals SET content='{}' WHERE id=$1", [a.id]),
    ).rejects.toThrow('immutable');
    const first = await store.decideApproval(ws, run.id, a.id, 'approve', a.content_hash);
    const again = await store.decideApproval(ws, run.id, a.id, 'approve', a.content_hash);
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    // Simulate a crash after the approved connector write but before its worker checkpoint.
    const claimed = await runtime.claimRun();
    expect(claimed?.id).toBe(run.id);
    const { callConnector } = await import('../lib/mcp-client');
    const saved = await callConnector<any>('save_brief', { runId: run.id, actionId: a.id });
    await db.pool.query("UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=$1", [
      run.id,
    ]);
    const recovered = await runtime.claimRun();
    expect(recovered?.id).toBe(run.id);
    await runtime.processRun(recovered!);
    run = await advance(run.id, 'awaiting_approval');
    expect(run.artifacts).toHaveLength(1);
    expect(run.artifacts[0].uri).toBe(saved.uri);
    expect(run.events.some((e: any) => e.kind === 'worker.recovered')).toBe(true);
    const publish = run.approvals.find((a: any) => a.action === 'publish_page');
    await store.decideApproval(ws, run.id, publish.id, 'approve', publish.content_hash);
    run = await advance(run.id, 'succeeded');
    expect(run.artifacts).toHaveLength(1);
    expect(
      (await db.pool.query('SELECT count(*) AS n FROM event_pages WHERE run_id=$1', [run.id]))
        .rows[0].n,
    ).toBe('1');
  });
  it('rejection prevents writes and remains stable under duplicate rejection', async () => {
    const run = await proposed();
    const a = run.approvals[0];
    await store.decideApproval(ws, run.id, a.id, 'reject', a.content_hash);
    await store.decideApproval(ws, run.id, a.id, 'reject', a.content_hash);
    expect((await store.getRun(ws, run.id)).status).toBe('rejected');
    expect(
      (await db.pool.query('SELECT count(*) AS n FROM artifacts WHERE run_id=$1', [run.id])).rows[0]
        .n,
    ).toBe('0');
    await expect(store.decideApproval(ws, run.id, a.id, 'approve', a.content_hash)).rejects.toThrow(
      'different decision',
    );
  });
  it('uses separate approval expiry; active execution does not consume approval wait time', async () => {
    const run = await proposed();
    const before = Number(run.active_ms);
    await runtime.expireApprovals();
    expect((await store.getRun(ws, run.id)).status).toBe('awaiting_approval');
    expect(Number((await store.getRun(ws, run.id)).active_ms)).toBe(before);
    await store.cancelRun(ws, run.id);
    // Create an expired approval directly to exercise the expiry transition without a clock sleep.
    const r = await store.startRun(ws, input(), 'expired-' + ++key);
    await db.pool.query("UPDATE runs SET status='awaiting_approval' WHERE id=$1", [r.id]);
    await db.pool.query(
      "INSERT INTO approvals(id,run_id,workspace_id,action,content,content_hash,expires_at) VALUES($1,$2,$3,'save_brief','{}',$4,now()-interval '1 second')",
      [r.id + '_expiry', r.id, ws, '0'.repeat(64)],
    );
    await runtime.expireApprovals();
    expect((await store.getRun(ws, r.id)).status).toBe('failed');
  });
  it('fences a cancelled worker and reports denied tools as real failures', async () => {
    const r = await store.startRun(ws, input(), 'fenced-' + ++key);
    const claimed = await runtime.claimRun();
    expect(claimed?.id).toBe(r.id);
    await store.cancelRun(ws, r.id);
    await runtime.processRun(claimed!);
    expect((await store.getRun(ws, r.id)).status).toBe('cancelled');
    const a = (await db.pool.query("SELECT * FROM agents WHERE id='agt_community'")).rows[0];
    const v = await store.saveAgent(
      ws,
      a.id,
      a.name,
      a.description,
      { ...a.draft, tools: ['venue_search'] },
      true,
    );
    const denied = await store.startRun(
      ws,
      { ...input(), versionId: v.versionId! },
      'denied-' + ++key,
    );
    const run = await advance(denied.id, 'awaiting_requirements');
    await store.reviewRequirements(ws, run.id, run.requirements);
    await tick();
    await tick();
    expect((await store.getRun(ws, run.id)).status).toBe('failed');
  });
  it('reports an actual MCP authentication failure without substituting source fixtures', async () => {
    const r = await store.startRun(ws, input(), 'connector-failure-' + ++key);
    const run = await advance(r.id, 'awaiting_requirements');
    await store.reviewRequirements(ws, run.id, run.requirements);
    await tick();
    const prior = process.env.CONNECTOR_SECRET;
    process.env.CONNECTOR_SECRET = 'deliberately-wrong-test-secret';
    try {
      await tick();
      const failed = await store.getRun(ws, run.id);
      expect(failed.status).toBe('failed');
      expect(failed.evidence).toHaveLength(0);
      expect(failed.steps.some((s: any) => s.kind === 'tool' && s.status === 'failed')).toBe(true);
    } finally {
      process.env.CONNECTOR_SECRET = prior;
    }
  });
  it('fails live extraction when credentials are absent and never uses fixture success', async () => {
    const prior = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const r = await store.startRun(ws, { ...input(), mode: 'live' }, 'live-missing-' + ++key);
      await tick();
      const run = await store.getRun(ws, r.id);
      expect(run.status).toBe('failed');
      expect(run.error).toContain('unavailable');
      expect(run.requirements).toBeNull();
      expect(run.evidence).toHaveLength(0);
    } finally {
      if (prior) process.env.GEMINI_API_KEY = prior;
    }
  });
  it('credits a verified signature once and rejects re-use on another invoice', async () => {
    const invoice = 'invoice_test_1';
    await db.pool.query(
      "INSERT INTO credit_invoices(id,workspace_id,recipient,payer,lamports,credits,network,expires_at) VALUES($1,$2,'recipient','payer',10000000,100,'devnet',now()+interval '1 hour')",
      [invoice, ws],
    );
    const [a, b] = await Promise.all([
      payments.settleVerifiedPayment(ws, invoice, 'test-finalized-signature'),
      payments.settleVerifiedPayment(ws, invoice, 'test-finalized-signature'),
    ]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(
      (
        await db.pool.query(
          "SELECT count(*) AS n FROM credit_ledger WHERE reference='solana:devnet:test-finalized-signature'",
        )
      ).rows[0].n,
    ).toBe('1');
    await db.pool.query(
      "INSERT INTO credit_invoices(id,workspace_id,recipient,payer,lamports,credits,network,expires_at) VALUES('invoice_test_2',$1,'recipient','payer',10000000,100,'devnet',now()+interval '1 hour')",
      [ws],
    );
    await expect(
      payments.settleVerifiedPayment(ws, 'invoice_test_2', 'test-finalized-signature'),
    ).rejects.toThrow('another invoice');
  });
});
