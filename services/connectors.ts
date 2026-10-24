import 'dotenv/config';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { pool, tx } from '../lib/db';
import { equal, hash, id, canonical } from '../lib/security';
import { fixtureHistory, fixtureVenues } from '../lib/fixtures';
import { putObject, getObject } from '../lib/artifact-storage';
import { connectorFailure } from '../lib/connector-errors';
import { searchWeb } from '../lib/serpapi';

const secret = process.env.CONNECTOR_SECRET;
if (!secret || secret.length < 24)
  throw new Error('Set a private CONNECTOR_SECRET of at least 24 characters');
async function runContext(runId: string, tool: string) {
  const run = (
    await pool.query(
      'SELECT r.*,v.config FROM runs r JOIN agent_versions v ON v.id=r.version_id WHERE r.id=$1',
      [runId],
    )
  ).rows[0];
  if (!run || !['running', 'queued'].includes(run.status)) throw new Error('Run is not active');
  if (!run.config.tools.includes(tool)) throw new Error('Tool permission denied');
  return run;
}
function createServer() {
  const server = new McpServer({ name: 'relay-trusted-connectors', version: '0.1.0' });
  function register(
    name: string,
    description: string,
    schema: Record<string, z.ZodType>,
    fn: (args: any) => Promise<unknown>,
  ) {
    server.registerTool(name, { description, inputSchema: schema }, async (args) => {
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(await fn(args)) }] };
      } catch (e) {
        const failure = connectorFailure(e);
        console.error('Connector failed:', name, failure.error.code);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(failure),
            },
          ],
        };
      }
    });
  }
  register(
    'org_history',
    'Retrieve workspace-scoped organization history and opted-in preference aggregates. No arbitrary SQL.',
    { runId: z.string() },
    async ({ runId }) => {
      const run = await runContext(runId, 'org_history');
      const now = new Date().toISOString();
      if (run.mode === 'fixture')
        return {
          evidence: fixtureHistory.map((e) => ({
            ...e,
            source: 'Snowflake fixture',
            fixture: true,
            retrievedAt: now,
          })),
          summary: 'Explicit synthetic organization history and opted-in preferences.',
        };
      throw new Error(
        'Organization history is deferred. Publish a version with SerpAPI search only.',
      );
    },
  );
  register(
    'venue_search',
    'Research venue evidence with SerpAPI. Search snippets are evidence, not confirmation of capacity, price or availability.',
    { runId: z.string(), query: z.string().min(5).max(500) },
    async ({ runId, query }) => {
      const run = await runContext(runId, 'venue_search');
      const now = new Date().toISOString();
      if (run.mode === 'fixture')
        return {
          query,
          evidence: fixtureVenues.map((e) => ({
            ...e,
            excerpt: e.excerpt + ' Requested search: ' + query,
            source: 'SerpAPI fixture',
            fixture: true,
            retrievedAt: now,
          })),
          summary: 'Fictional venue records. No live search was made.',
        };
      return searchWeb(query);
    },
  );
  register(
    'save_brief',
    'Save only the immutable, exact content of an approved save_brief action to private storage.',
    { runId: z.string(), actionId: z.string() },
    async ({ runId, actionId }) => {
      // Hold the run row lock across the write. Cancellation and decisions serialize with this action.
      return tx(async (db) => {
        const run = (
          await db.query(
            'SELECT r.*,v.config FROM runs r JOIN agent_versions v ON v.id=r.version_id WHERE r.id=$1 FOR UPDATE OF r',
            [runId],
          )
        ).rows[0];
        if (
          !run ||
          !['running', 'queued'].includes(run.status) ||
          !run.config.tools.includes('save_brief')
        )
          throw new Error('Write permission denied');
        const a = (
          await db.query(
            "SELECT * FROM approvals WHERE id=$1 AND run_id=$2 AND workspace_id=$3 AND status='approved' AND action='save_brief'",
            [actionId, runId, run.workspace_id],
          )
        ).rows[0];
        if (!a || hash(a.content) !== a.content_hash)
          throw new Error('Exact approved action missing');
        const prior = (await db.query('SELECT * FROM artifacts WHERE action_id=$1', [actionId]))
          .rows[0];
        if (prior) return prior;
        const uri = await putObject(
          `${run.workspace_id}/${runId}/${actionId}.json`,
          Buffer.from(canonical(a.content)),
          'application/json',
          run.mode === 'fixture',
        );
        await db.query(
          'INSERT INTO artifacts(action_id,run_id,workspace_id,uri,content_hash) VALUES($1,$2,$3,$4,$5)',
          [actionId, runId, run.workspace_id, uri, a.content_hash],
        );
        return { action_id: actionId, uri, content_hash: a.content_hash };
      });
    },
  );
  register(
    'upload_input',
    'Store a private flyer or PDF. Invoked only by the authenticated dashboard.',
    {
      workspace: z.string(),
      name: z.string().max(150),
      mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
      base64: z.string().max(7000000),
      fixture: z.boolean(),
    },
    async ({ workspace, name, mimeType, base64, fixture }) => {
      if (workspace !== (process.env.WORKSPACE_ID || 'hacktx-demo'))
        throw new Error('Workspace denied');
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length > 5000000) throw new Error('File too large');
      const valid =
        mimeType === 'application/pdf'
          ? bytes.subarray(0, 5).toString() === '%PDF-'
          : mimeType === 'image/png'
            ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes[0] === 255 && bytes[1] === 216;
      if (!valid) throw new Error('File signature does not match type');
      const fileId = id('file');
      const uri = await putObject(`${workspace}/inputs/${fileId}`, bytes, mimeType, fixture);
      await pool.query(
        'INSERT INTO input_files(id,workspace_id,uri,mime_type,name) VALUES($1,$2,$3,$4,$5)',
        [fileId, workspace, uri, mimeType, name],
      );
      return { id: fileId, name, mimeType };
    },
  );
  register(
    'get_input',
    'Load the private input attached to an active run for Meta extraction. Never included in traces.',
    { runId: z.string() },
    async ({ runId }) => {
      const r = (
        await pool.query(
          "SELECT r.workspace_id,r.input FROM runs r WHERE id=$1 AND status='running'",
          [runId],
        )
      ).rows[0];
      if (!r?.input.fileId) throw new Error('No active run input');
      const f = (
        await pool.query('SELECT * FROM input_files WHERE id=$1 AND workspace_id=$2', [
          r.input.fileId,
          r.workspace_id,
        ])
      ).rows[0];
      if (!f) throw new Error('Input scope denied');
      return { mimeType: f.mime_type, base64: (await getObject(f.uri)).toString('base64') };
    },
  );
  register(
    'get_artifact',
    'Read a workspace-owned approved artifact.',
    { workspace: z.string(), actionId: z.string() },
    async ({ workspace, actionId }) => {
      const a = (
        await pool.query('SELECT * FROM artifacts WHERE action_id=$1 AND workspace_id=$2', [
          actionId,
          workspace,
        ])
      ).rows[0];
      if (!a) throw new Error('Artifact unavailable');
      return JSON.parse((await getObject(a.uri)).toString());
    },
  );
  return server;
}
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'trusted-connectors' }));
app.post('/mcp', async (req, res) => {
  if (!equal(req.headers.authorization || '', 'Bearer ' + secret))
    return void res.status(401).json({ error: 'Unauthorized' });
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
  }
});
app.listen(
  Number(process.env.CONNECTOR_PORT || 3101),
  process.env.CONNECTOR_HOST || '127.0.0.1',
  () =>
    console.log('Private MCP connectors listening on port ' + (process.env.CONNECTOR_PORT || 3101)),
);
