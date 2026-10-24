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
  versionId: 'ver_community_meta_1',
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
    env: {
      ...process.env,
      CONNECTOR_PORT: String(connectorPort),
      RELAY_ARTIFACT_DIR: '.data/test-artifacts/' + crypto.randomUUID(),
    },
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
  it('persists workflow pages, scopes access, archives without cancellation, and debits a duplicate launch once', async () => {
    const pages = await import('../lib/workflows');
    const { planFixtureTree } = await import('../lib/agent-tree');
    const payload = {
      name: 'Persistent test workflow',
      kind: 'tree',
      task: 'Summarize a welcoming community task.',
      tree: planFixtureTree('Summarize a short paragraph.', 'simple'),
    };
    const idem = 'page-create-' + ++key;
    const created = await pages.createWorkflow(ws, payload, idem);
    expect((await pages.createWorkflow(ws, payload, idem)).id).toBe(created.id);
    await expect(pages.createWorkflow(ws, { ...payload, name: 'Different' }, idem)).rejects.toThrow(
      'another page',
    );
    await expect(pages.getWorkflow('other-workspace', created.id)).rejects.toThrow('not found');
    await expect(
      pages.editWorkflow('other-workspace', created.id, { revision: 1, name: 'Stolen' }),
    ).rejects.toThrow('not found');
    const edited = await pages.editWorkflow(ws, created.id, {
      revision: 1,
      name: 'Edited workflow',
    });
    expect(edited.revision).toBe(2);
    await expect(
      pages.editWorkflow(ws, created.id, { revision: 1, name: 'Stale' }),
    ).rejects.toThrow('another tab');
    const balance = Number((await store.usage(ws)).balance);
    const launchKey = 'page-launch-' + ++key;
    const launch = await pages.launchWorkflow(ws, created.id, { revision: 2 }, launchKey);
    expect((await pages.launchWorkflow(ws, created.id, { revision: 2 }, launchKey)).id).toBe(
      launch.id,
    );
    expect(Number((await store.usage(ws)).balance)).toBe(balance - 1);
    const archived = await pages.editWorkflow(ws, created.id, { revision: 2, archived: true });
    expect((await store.getRun(ws, launch.id)).status).toBe('queued');
    expect((await store.getRun(ws, launch.id)).workflow_id).toBe(created.id);
    await expect(
      pages.launchWorkflow(ws, created.id, { revision: archived.revision }, 'archive-' + ++key),
    ).rejects.toThrow('Restore');
    expect((await pages.launchWorkflow(ws, created.id, { revision: 2 }, launchKey)).id).toBe(
      launch.id,
    );
    await advance(launch.id, 'succeeded');
    const history = await pages.getWorkflow(ws, created.id);
    expect(history.runs).toHaveLength(1);
    expect(history.tree).toEqual(payload.tree);
    expect(history.archived_at).toBeTruthy();
    await pages.editWorkflow(ws, created.id, { revision: archived.revision, archived: false });
  });
  it('creates reusable library agents idempotently and scopes diagnostic aggregates', async () => {
    const pages = await import('../lib/workflows');
    const { specialistTree } = await import('../lib/agent-presets');
    const { defaultConfig } = await import('../lib/config');
    const tree = specialistTree({
      name: 'Test writer',
      instructions: 'Write a concise response for the supplied task.',
      model: 'muse-spark-1.3',
      mode: 'reason',
      tools: [],
    });
    const payload = {
      name: 'Test reusable specialist',
      description: 'Labeled isolated test agent',
      publish: true,
      config: {
        ...defaultConfig,
        workflowKind: 'tree',
        tree,
        readOnly: true,
        outputFormat: 'agent_tree_json',
        tools: [],
      },
    };
    const idem = 'library-' + ++key;
    const a = await pages.createLibraryAgent(ws, payload, idem);
    expect((await pages.createLibraryAgent(ws, payload, idem)).versionId).toBe(a.versionId);
    await expect(
      pages.createWorkflow(
        'other-workspace',
        { name: 'Stolen version', kind: 'agent', versionId: a.versionId },
        'cross-' + ++key,
      ),
    ).rejects.toThrow('not found');
    const page = await pages.createWorkflow(
      ws,
      {
        name: 'Single specialist',
        kind: 'agent',
        versionId: a.versionId,
        task: 'Write a warm demonstration greeting.',
      },
      'single-' + ++key,
    );
    const run = await pages.launchWorkflow(ws, page.id, { revision: 1 }, 'single-run-' + ++key);
    await advance(run.id, 'succeeded');
    const { diagnostics } = await import('../lib/diagnostics');
    const stats = await diagnostics(ws, 'all', 'fixture');
    expect(stats.workflows.some((w: any) => w.id === page.id)).toBe(true);
    expect(stats.models.some((m: any) => m.model === 'muse-spark-1.3')).toBe(true);
    expect(Number((await diagnostics('other-workspace', 'all', 'all')).totals.steps)).toBe(0);
    expect(Number((await diagnostics(ws, 'all', 'live')).totals.steps)).toBe(0);
    const native = await store.startRun(
      ws,
      {
        versionId: a.versionId!,
        input: { brief: 'Write a second demonstration greeting.' },
        mode: 'fixture',
      },
      'library-default-' + ++key,
    );
    await advance(native.id, 'succeeded');
    const defaultPage = await pages.getWorkflow(ws, 'wf_' + a.id);
    const fork = await pages.launchWorkflow(
      ws,
      defaultPage.id,
      { revision: defaultPage.revision },
      'page-fork-' + ++key,
    );
    await advance(fork.id, 'succeeded');
    expect((await pages.getWorkflow(ws, defaultPage.id)).agent_id).not.toBe(a.id);
    expect(
      (await db.pool.query('SELECT count(*) AS n FROM agent_versions WHERE agent_id=$1', [a.id]))
        .rows[0].n,
    ).toBe('1');
  });
  it('publishes a reusable manual tree, deduplicates saves, and executes configured nodes through recovery', async () => {
    const { defaultTree } = await import('../lib/agent-tree');
    const { saveTree } = await import('../lib/tree-store');
    const payload = {
      name: 'Isolated tree test',
      task: 'Compare welcoming meetup options near UT Austin for 84 people within a $2400 budget.',
      tree: defaultTree(),
      publish: true,
    };
    const requestKey = 'save-tree-' + ++key;
    const saved = await saveTree(ws, payload, requestKey);
    const duplicate = await saveTree(ws, payload, requestKey);
    expect(saved.versionId).toBe(duplicate.versionId);
    expect(duplicate.replayed).toBe(true);
    await expect(saveTree(ws, { ...payload, name: 'Different tree' }, requestKey)).rejects.toThrow(
      'another tree',
    );
    await expect(
      saveTree('other-workspace', { ...payload, agentId: saved.id }, 'cross-workspace'),
    ).rejects.toThrow('not found');
    const created = await store.startRun(
      ws,
      { versionId: saved.versionId!, input: { brief: payload.task }, mode: 'fixture' },
      'tree-run-' + ++key,
    );
    await tick();
    const abandoned = await runtime.claimRun();
    expect(abandoned?.id).toBe(created.id);
    const { callConnector } = await import('../lib/mcp-client');
    const sources = await callConnector('venue_search', {
      runId: created.id,
      query: 'Meetup near UT Austin for 84 people',
    });
    // The tool observation committed, then the worker died before checkpointing sources.
    await db.pool.query(
      "INSERT INTO steps(run_id,id,name,kind,parent_id,status,input,output) VALUES($1,'agent_venues__venue_search','Venue researcher · venue_search','tool','agent_venues','succeeded',$2,$3)",
      [created.id, { nodeId: 'venues', tool: 'venue_search' }, sources],
    );
    await db.pool.query("UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=$1", [
      created.id,
    ]);
    const run = await advance(created.id, 'succeeded');
    expect(run.output.kind).toBe('agent_tree');
    expect(run.output.results).toHaveLength(payload.tree.nodes.length);
    expect(run.steps.filter((s: any) => s.kind === 'model')).toHaveLength(
      payload.tree.nodes.length,
    );
    expect(run.steps.at(-1).input.nodeId).toBe('user');
    expect(run.evidence.length).toBe(3);
    expect(run.approvals).toHaveLength(0);
    expect(run.artifacts).toHaveLength(0);
    expect(run.events.some((e: any) => e.kind === 'worker.recovered')).toBe(true);
    const modified = structuredClone(payload.tree);
    modified.nodes[1].model = 'custom-muse-model-id';
    const next = await saveTree(
      ws,
      { ...payload, agentId: saved.id, tree: modified },
      'tree-v2-' + ++key,
    );
    expect(next.version).toBe(2);
    const oldVersion = await store.version(ws, saved.versionId!);
    expect(oldVersion.config.tree.nodes[1].model).toBe('muse-spark-1.3');
    expect((await store.getRun(ws, run.id)).version_id).toBe(saved.versionId);
  });
  it('runs the complexity planner durably and changes team size with the task', async () => {
    const { plannerVersion } = await import('../lib/tree-store');
    const v = await plannerVersion(ws, 'auto', 'muse', 'muse-spark-1.3');
    const simple = await store.startRun(
      ws,
      { versionId: v, input: { brief: 'Summarize a short paragraph.' }, mode: 'fixture' },
      'planner-simple-' + ++key,
    );
    const simpleRun = await advance(simple.id, 'succeeded');
    expect(simpleRun.output.tree.nodes).toHaveLength(2);
    expect(simpleRun.output.planning.mode).toBe('fixture');
    const complex = await store.startRun(
      ws,
      {
        versionId: v,
        input: {
          brief:
            'Plan and research an accessible community meetup, compare venues, budget and schedule, review risks and sources, and draft invitations.',
        },
        mode: 'fixture',
      },
      'planner-complex-' + ++key,
    );
    const complexRun = await advance(complex.id, 'succeeded');
    expect(complexRun.output.tree.nodes).toHaveLength(7);
    expect(complexRun.steps).toHaveLength(1);
    expect(complexRun.output.planning.model).toBeNull();
  });
  it('honors a tree node provider and fails without its live credential', async () => {
    const { planFixtureTree } = await import('../lib/agent-tree');
    const { saveTree } = await import('../lib/tree-store');
    const tree = planFixtureTree('Summarize this community task.', 'simple');
    const saved = await saveTree(
      ws,
      { name: 'Live node failure', task: 'Summarize this community task.', tree, publish: true },
      'tree-live-save-' + ++key,
    );
    const prior = process.env.MUSE_API_KEY;
    delete process.env.MUSE_API_KEY;
    try {
      const created = await store.startRun(
        ws,
        {
          versionId: saved.versionId!,
          input: { brief: 'Summarize this community task.' },
          mode: 'live',
        },
        'tree-live-' + ++key,
      );
      await tick();
      const run = await store.getRun(ws, created.id);
      expect(run.status).toBe('failed');
      expect(run.error).toContain('Muse Spark unavailable');
      expect(run.steps[0].input.provider).toBe('muse');
      expect(run.output).toBeNull();
    } finally {
      if (prior) process.env.MUSE_API_KEY = prior;
    }
  });
  it('pins immutable versions and duplicates configurations without publishing the copy', async () => {
    await expect(
      db.pool.query("UPDATE agent_versions SET config='{}' WHERE id='ver_community_meta_1'"),
    ).rejects.toThrow('immutable');
    const copy = await store.duplicateAgent(ws, 'agt_community_meta');
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
    expect(p.evidence).toHaveLength(3);
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
    // Keep synthetic model content labeled. Exercise only the real disk-storage path.
    await db.pool.query("UPDATE runs SET mode='live' WHERE id=$1", [run.id]);
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
    expect(saved.uri.startsWith('local://')).toBe(true);
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
    const a = (await db.pool.query("SELECT * FROM agents WHERE id='agt_community_meta'")).rows[0];
    const v = await store.saveAgent(
      ws,
      a.id,
      a.name,
      a.description,
      { ...a.draft, tools: [] },
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
    const prior = process.env.MUSE_API_KEY;
    delete process.env.MUSE_API_KEY;
    try {
      const r = await store.startRun(ws, { ...input(), mode: 'live' }, 'live-missing-' + ++key);
      await tick();
      const run = await store.getRun(ws, r.id);
      expect(run.status).toBe('failed');
      expect(run.error).toContain('unavailable');
      expect(run.requirements).toBeNull();
      expect(run.evidence).toHaveLength(0);
    } finally {
      if (prior) process.env.MUSE_API_KEY = prior;
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
