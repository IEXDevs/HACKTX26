import { z } from "zod";

const text = z.string();
const strings = z.array(text);
const argumentsObject = z.record(z.string(), z.unknown());
const command = z.object({ command: text });

/** One argument contract per capability. Connected app payloads remain extensible. */
export const TOOL_ARGUMENT_SCHEMAS = {
  "fs.list": z.object({ path: text.optional() }),
  "fs.read": z.object({ path: text }),
  "fs.write": z.object({ path: text, content: text }),
  "fs.delete": z.object({ path: text }),
  "shell.exec": command,
  "cli.run": command,
  "http.fetch": z.object({ url: text }),
  "kb.search": z.object({ query: text, topK: z.number().optional() }),
  "memory.write": z.object({ content: text, scope: text.optional(), kind: text.optional() }),
  "memory.search": z.object({ query: text.optional() }),
  "context.read": z.object({}),
  "context.write": z.object({ content: text.optional(), include: text.optional(), remove: text.optional() }),
  "task.handoff": z.object({ summary: text.optional() }),
  "user.ask": z.object({ question: text, reason: text }),
  "motivator.report": z.object({ blocker: text, attempts: strings, evidence: text.optional(), remainingOptions: strings.optional() }),
  "agent.delegate": z.object({ agent: text, task: text, title: text.optional(), tools: strings.optional(), connectors: strings.optional(), model: text.optional(), complexity: text.optional(), case: text.optional() }),
  "security.report": z.object({ severity: text, category: text, title: text, detail: text, evidence: text.optional(), remediation: text.optional() }),
  "connector.call": z.object({ toolkit: text, action: text, arguments: argumentsObject.optional() }).passthrough(),
  "web.search": z.object({ query: text, engine: text.optional(), num: z.number().optional() }),
  "mcp.call": z.object({ server: text, tool: text, args: argumentsObject.optional() }),
  "secret.use": z.object({ credential: text }),
};

export function parametersForTool(name: string): Record<string, unknown> {
  const schema = TOOL_ARGUMENT_SCHEMAS[name as keyof typeof TOOL_ARGUMENT_SCHEMAS];
  if (!schema) throw new Error(`No argument schema for ${name}.`);
  const { $schema: _dialect, ...parameters } = z.toJSONSchema(schema);
  return parameters;
}
