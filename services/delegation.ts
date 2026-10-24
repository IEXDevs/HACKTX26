import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
// Public delegation uses platform keys, not CONNECTOR_SECRET or provider credentials.
const key = process.env.RELAY_API_KEY;
if (!key) throw new Error('RELAY_API_KEY is required for the delegation MCP server');
const server = new McpServer({ name: 'relay-delegation', version: '0.1.0' });
async function request(path: string, method = 'GET', body?: unknown, idem?: string) {
  const response = await fetch((process.env.APP_URL || 'http://127.0.0.1:3000') + '/v1/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...(idem ? { 'Idempotency-Key': idem } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  return {
    isError: !response.ok,
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  };
}
server.registerTool(
  'start_agent_run',
  {
    description:
      'Start a saved agent version. Returns a durable run ID. Humans must confirm requirements and approve writes through Relay.',
    inputSchema: {
      versionId: z.string(),
      brief: z.string().min(10).max(15000),
      idempotencyKey: z.string().min(1).max(200),
    },
  },
  async ({ versionId, brief, idempotencyKey }) =>
    request('runs', 'POST', { versionId, input: { brief } }, idempotencyKey),
);
server.registerTool(
  'get_agent_run',
  {
    description:
      'Retrieve run state, observed execution steps, evidence, and pending human approvals.',
    inputSchema: { runId: z.string() },
  },
  async ({ runId }) => request('runs/' + encodeURIComponent(runId)),
);
await server.connect(new StdioServerTransport());
