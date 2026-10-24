import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export async function callConnector<T = unknown>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!process.env.CONNECTOR_SECRET)
    throw new Error('Private MCP connector is unavailable: CONNECTOR_SECRET is missing');
  const client = new Client({ name: 'relay-runtime', version: '0.1.0' });
  try {
    const transport = new StreamableHTTPClientTransport(
      new URL(process.env.CONNECTOR_URL || 'http://127.0.0.1:3101/mcp'),
      { requestInit: { headers: { Authorization: 'Bearer ' + process.env.CONNECTOR_SECRET } } },
    );
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 25000 });
    if (result.isError) throw new Error('MCP tool failed: ' + name);
    const content = result.content as { type: string; text?: string }[];
    return JSON.parse(content.find((c) => c.type === 'text')?.text || 'null') as T;
  } finally {
    await client.close();
  }
}
