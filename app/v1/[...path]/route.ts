import { z } from 'zod';
import { pool, tx } from '@/lib/db';
import {
  authorize,
  hash,
  id,
  safeError,
  equal,
  makeSession,
  redact,
  appOrigin,
} from '@/lib/security';
import { mode, HttpError, agentConfigSchema } from '@/lib/config';
import {
  startRun,
  getRun,
  reviewRequirements,
  decideApproval,
  cancelRun,
  saveAgent,
  duplicateAgent,
  usage,
  version,
} from '@/lib/store';
import { callConnector } from '@/lib/mcp-client';
import { createInvoice, creditPayment } from '@/lib/payments';
import { connections } from '@/lib/connections';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function body(req: Request) {
  const text = await req.text();
  if (text.length > 100000) throw new HttpError(413, 'JSON payload too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}
async function route(
  req: Request,
  ctx: Context,
  tracking: { workspace?: string },
): Promise<Response> {
  const { path } = await ctx.params;
  const [resource, resourceId, action, actionId] = path;
  const method = req.method;
  if (resource === 'health') {
    try {
      await pool.query('SELECT 1');
      return json({ ok: true, service: 'relay-web' });
    } catch {
      return json({ ok: false }, 503);
    }
  }
  if (resource === 'session' && method === 'POST') {
    if (req.headers.get('origin') !== appOrigin(req))
      throw new HttpError(403, 'Same-origin sign-in required');
    const b = z
      .object({ password: z.string().max(200) })
      .strict()
      .parse(await body(req));
    if (
      !process.env.DASHBOARD_PASSWORD ||
      !process.env.SESSION_SECRET ||
      !equal(b.password, process.env.DASHBOARD_PASSWORD)
    )
      throw new HttpError(401, 'Incorrect workspace password or server is not configured');
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `relay_session=${makeSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
      },
    });
  }
  if (resource === 'session' && method === 'DELETE')
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': 'relay_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
    });
  const scope =
    resource === 'runs'
      ? method === 'GET'
        ? 'runs:read'
        : action === 'approvals'
          ? 'approvals:write'
          : 'runs:write'
      : resource === 'chat'
        ? 'runs:write'
        : resource === 'credits'
          ? 'credits:write'
          : 'agents:read';
  const auth = await authorize(
    req,
    scope,
    ['dashboard', 'keys', 'agents', 'connections', 'uploads', 'usage', 'requests'].includes(
      resource,
    ),
  );
  const ws = auth.workspace;
  if (auth.kind === 'api') tracking.workspace = ws;
  if (resource === 'requests' && method === 'GET')
    return json({
      data: (
        await pool.query(
          'SELECT method,path,status,created_at FROM api_requests WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 30',
          [ws],
        )
      ).rows,
    });
  if (resource === 'dashboard' && method === 'GET') {
    const [agents, runs, stats, workspace] = await Promise.all([
      pool.query(
        "SELECT a.*,COALESCE((SELECT jsonb_agg(v ORDER BY v.version DESC) FROM agent_versions v WHERE v.agent_id=a.id),'[]'::jsonb) AS versions FROM agents a WHERE a.workspace_id=$1 ORDER BY a.created_at",
        [ws],
      ),
      pool.query(
        'SELECT r.id,r.status,r.mode,r.version_id,r.created_at,r.updated_at,r.active_ms,a.name AS agent_name FROM runs r JOIN agent_versions v ON v.id=r.version_id JOIN agents a ON a.id=v.agent_id WHERE r.workspace_id=$1 ORDER BY r.created_at DESC LIMIT 50',
        [ws],
      ),
      usage(ws),
      pool.query('SELECT * FROM workspaces WHERE id=$1', [ws]),
    ]);
    return json({
      agents: agents.rows,
      runs: runs.rows,
      usage: stats,
      workspace: workspace.rows[0],
      mode: mode(),
      connections: connections(),
    });
  }
  if (resource === 'agents') {
    if (method === 'GET')
      return json({
        data: (
          await pool.query('SELECT id,name,description FROM agents WHERE workspace_id=$1', [ws])
        ).rows,
      });
    if (method === 'POST' && action === 'duplicate')
      return json(await duplicateAgent(ws, resourceId), 201);
    if (method === 'PUT') {
      const b = z
        .object({
          name: z.string().min(1).max(150),
          description: z.string().max(500),
          config: agentConfigSchema,
          publish: z.boolean(),
        })
        .strict()
        .parse(await body(req));
      return json(await saveAgent(ws, resourceId, b.name, b.description, b.config, b.publish));
    }
  }
  if (resource === 'versions' && method === 'GET') return json(await version(ws, resourceId));
  if (resource === 'runs') {
    if (method === 'POST' && !resourceId) {
      const b = z
        .object({
          versionId: z.string(),
          input: z
            .object({ brief: z.string().min(10).max(15000), fileId: z.string().optional() })
            .strict(),
          mode: z.enum(['live', 'fixture']).optional(),
        })
        .strict()
        .parse(await body(req));
      if (b.mode && b.mode !== mode())
        throw new HttpError(409, 'Requested mode differs from the configured server mode');
      const run = await startRun(
        ws,
        { ...b, mode: mode() },
        req.headers.get('idempotency-key') || '',
      );
      return json({ ...run, status: 'accepted', url: '/v1/runs/' + run.id }, 202);
    }
    if (method === 'GET' && !resourceId)
      return json({
        data: (
          await pool.query(
            'SELECT id,version_id,status,mode,created_at FROM runs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100',
            [ws],
          )
        ).rows,
      });
    if (method === 'GET' && action === 'events') {
      await getRun(ws, resourceId);
      const url = new URL(req.url);
      const after = Number(req.headers.get('last-event-id') || url.searchParams.get('after') || 0);
      if (!Number.isSafeInteger(after) || after < 0)
        throw new HttpError(400, 'Invalid event cursor');
      if (url.searchParams.get('stream') !== 'true')
        return json({
          data: (
            await pool.query(
              'SELECT * FROM run_events WHERE run_id=$1 AND id>$2 ORDER BY id LIMIT 500',
              [resourceId, after],
            )
          ).rows,
        });
      let cursor = after;
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const send = async () => {
            if (closed) return;
            try {
              const events = (
                await pool.query(
                  'SELECT * FROM run_events WHERE run_id=$1 AND id>$2 ORDER BY id LIMIT 200',
                  [resourceId, cursor],
                )
              ).rows;
              for (const event of events) {
                controller.enqueue(
                  encoder.encode(
                    `id: ${event.id}\nevent: execution\ndata: ${JSON.stringify(event)}\n\n`,
                  ),
                );
                cursor = Number(event.id);
              }
              controller.enqueue(encoder.encode(': keepalive\n\n'));
              const state = (await pool.query('SELECT status FROM runs WHERE id=$1', [resourceId]))
                .rows[0]?.status;
              if (['succeeded', 'failed', 'rejected', 'cancelled'].includes(state)) {
                controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
                controller.close();
                closed = true;
                return;
              }
              timer = setTimeout(() => void send(), 1200);
            } catch {
              if (!closed) {
                closed = true;
                controller.error(new Error('Stream disconnected. Reconnect with Last-Event-ID.'));
              }
            }
          };
          void send();
        },
        cancel() {
          closed = true;
          if (timer) clearTimeout(timer);
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
          Connection: 'keep-alive',
        },
      });
    }
    if (method === 'GET' && resourceId) return json(await getRun(ws, resourceId));
    if (method === 'POST' && action === 'requirements')
      return json(await reviewRequirements(ws, resourceId, await body(req)));
    if (method === 'POST' && action === 'cancel') return json(await cancelRun(ws, resourceId));
    if (method === 'POST' && action === 'approvals' && actionId) {
      const b = z
        .object({ decision: z.enum(['approve', 'reject']), contentHash: z.string().length(64) })
        .strict()
        .parse(await body(req));
      return json(await decideApproval(ws, resourceId, actionId, b.decision, b.contentHash));
    }
  }
  if (resource === 'artifacts' && method === 'GET')
    return json(await callConnector('get_artifact', { workspace: ws, actionId: resourceId }));
  if (resource === 'uploads' && method === 'POST') {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size > 5000000)
      throw new HttpError(400, 'Attach a PDF, PNG, or JPEG up to 5 MB');
    const mime = z.enum(['application/pdf', 'image/png', 'image/jpeg']).parse(file.type);
    return json(
      await callConnector('upload_input', {
        workspace: ws,
        name: file.name,
        mimeType: mime,
        base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
        fixture: mode() === 'fixture',
      }),
      201,
    );
  }
  if (resource === 'keys') {
    if (method === 'GET')
      return json({
        data: (
          await pool.query(
            'SELECT id,name,prefix,scopes,created_at,revoked_at FROM api_keys WHERE workspace_id=$1 ORDER BY created_at DESC',
            [ws],
          )
        ).rows,
      });
    if (method === 'POST') {
      const b = z
        .object({
          name: z.string().min(1).max(100),
          scopes: z
            .array(
              z.enum([
                'runs:read',
                'runs:write',
                'approvals:write',
                'agents:read',
                'credits:write',
              ]),
            )
            .min(1),
        })
        .strict()
        .parse(await body(req));
      const key = 'relay_test_' + id('key');
      const keyId = id('key');
      await pool.query(
        'INSERT INTO api_keys(id,workspace_id,name,key_hash,prefix,scopes) VALUES($1,$2,$3,$4,$5,$6)',
        [keyId, ws, b.name, hash(key), key.slice(0, 18), b.scopes],
      );
      return json({ id: keyId, key, notice: 'Copy this key now. Only its hash is stored.' }, 201);
    }
    if (method === 'DELETE') {
      await pool.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND workspace_id=$2', [
        resourceId,
        ws,
      ]);
      return json({ ok: true });
    }
  }
  if (resource === 'usage' && method === 'GET') return json(await usage(ws));
  if (resource === 'connections' && method === 'GET') return json({ data: connections() });
  if (resource === 'credits' && method === 'POST') {
    if (resourceId === 'invoices') {
      const b = z
        .object({ payer: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) })
        .strict()
        .parse(await body(req));
      return json(await createInvoice(ws, b.payer), 201);
    }
    if (resourceId === 'verify') {
      const b = z
        .object({
          invoiceId: z.string(),
          signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/),
        })
        .strict()
        .parse(await body(req));
      return json(await creditPayment(ws, b.invoiceId, b.signature));
    }
  }
  if (resource === 'chat' && resourceId === 'completions' && method === 'POST') {
    const b = z
      .object({
        model: z.string(),
        messages: z
          .array(
            z
              .object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })
              .strict(),
          )
          .min(1)
          .max(8),
        stream: z.literal(false).optional(),
      })
      .strict()
      .parse(await body(req));
    const v = await version(ws, b.model);
    if (!v.config.readOnly)
      throw new HttpError(
        400,
        'This published agent needs the native runs API. Completion tasks must use a readOnly agent.',
      );
    const text = b.messages.map((m) => m.role + ': ' + m.content).join('\n');
    const run = await startRun(
      ws,
      { versionId: b.model, input: { brief: text }, mode: mode() },
      req.headers.get('idempotency-key') || '',
      'completion',
    );
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      const result = (
        await pool.query('SELECT status,output,error FROM runs WHERE id=$1', [run.id])
      ).rows[0];
      if (result.status === 'succeeded')
        return json({
          id: run.id,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: b.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: result.output.content },
              finish_reason: 'stop',
            },
          ],
        });
      if (result.status === 'failed') throw new HttpError(502, 'Agent failed: ' + result.error);
      await new Promise((r) => setTimeout(r, 250));
    }
    return json(
      {
        error: {
          message: 'Completion deadline reached. Retrieve the durable run with the native API.',
          runId: run.id,
        },
      },
      504,
    );
  }
  throw new HttpError(404, 'Endpoint not found');
}
async function handle(req: Request, ctx: Context) {
  const tracking: { workspace?: string } = {};
  let response: Response;
  try {
    response = await route(req, ctx, tracking);
  } catch (e) {
    const err = safeError(e);
    response = json({ error: { message: err.message } }, err.status);
  }
  if (tracking.workspace) {
    try {
      await pool.query(
        'INSERT INTO api_requests(id,workspace_id,method,path,status) VALUES($1,$2,$3,$4,$5)',
        [id('request'), tracking.workspace, req.method, new URL(req.url).pathname, response.status],
      );
    } catch {
      console.error('API request audit could not be stored');
    }
  }
  return response;
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
