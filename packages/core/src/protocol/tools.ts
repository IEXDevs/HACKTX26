/**
 * Tool manifest.
 *
 * One declaration per capability, shared by the runtime (to build the executor
 * and the model's tool schema), the policy engine (risk + scopes), and the UI
 * (the permission matrix). Adding a capability means adding one entry here.
 */
import { z } from "zod";
import { RiskSchema } from "./events";
import { ScopeSchema } from "./permissions";

export const ToolCategorySchema = z.enum([
  "filesystem",
  "shell",
  "network",
  "knowledge",
  "mcp",
  "cli",
  "meta",
]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export const ToolManifestEntrySchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  category: ToolCategorySchema,
  scopes: z.array(ScopeSchema),
  risk: RiskSchema,
  /** Deny-by-default sandbox root, e.g. the agent's own directory. */
  sandboxedToAgentFs: z.boolean().default(true),
  /** Extra time the runtime allows before killing the call. */
  timeoutMs: z.number().int().positive().optional(),
  /** Human-readable shape of the arguments, for the permission matrix UI. */
  argsHint: z.string().optional(),
});
export type ToolManifestEntry = z.infer<typeof ToolManifestEntrySchema>;

export const TOOL_MANIFEST: readonly ToolManifestEntry[] = [
  {
    name: "fs.list",
    label: "List files",
    description: "List the agent's sandboxed filesystem.",
    category: "filesystem",
    scopes: ["read"],
    risk: "low",
    sandboxedToAgentFs: true,
  },
  {
    name: "fs.read",
    label: "Read file",
    description: "Read a UTF-8 file from the agent sandbox.",
    category: "filesystem",
    scopes: ["read"],
    risk: "low",
    sandboxedToAgentFs: true,
    argsHint: "{ path: string }",
  },
  {
    name: "fs.write",
    label: "Write file",
    description: "Create or overwrite a file inside the agent sandbox.",
    category: "filesystem",
    scopes: ["write"],
    risk: "medium",
    sandboxedToAgentFs: true,
    argsHint: "{ path: string, content: string }",
  },
  {
    name: "fs.delete",
    label: "Delete file",
    description: "Delete a path inside the agent sandbox.",
    category: "filesystem",
    scopes: ["write"],
    risk: "high",
    sandboxedToAgentFs: true,
  },
  {
    name: "shell.exec",
    label: "Shell",
    description: "Run a command in the agent sandbox with a hard timeout.",
    category: "shell",
    scopes: ["execute"],
    risk: "high",
    sandboxedToAgentFs: true,
    timeoutMs: 60_000,
    argsHint: "{ command: string }",
  },
  {
    name: "http.fetch",
    label: "HTTP fetch",
    description: "GET an allowlisted host and return text.",
    category: "network",
    scopes: ["net", "read"],
    risk: "medium",
    sandboxedToAgentFs: false,
    timeoutMs: 20_000,
    argsHint: "{ url: string }",
  },
  {
    name: "kb.search",
    label: "Knowledge base",
    description: "Semantic search across indexed workspace documents.",
    category: "knowledge",
    scopes: ["read"],
    risk: "low",
    sandboxedToAgentFs: false,
    argsHint: "{ query: string, topK?: number }",
  },
  {
    name: "memory.write",
    label: "Write memory",
    description: "Persist a durable fact, decision or preference for later runs.",
    category: "meta",
    scopes: ["write"],
    risk: "low",
    sandboxedToAgentFs: false,
  },
  {
    name: "memory.search",
    label: "Recall memory",
    description: "Search this workspace's memory store.",
    category: "meta",
    scopes: ["read"],
    risk: "low",
    sandboxedToAgentFs: false,
  },
  {
    name: "context.read",
    label: "Read workspace context",
    description:
      "Read CONTEXT.md, the shared workspace file for tech stack, layout, conventions, and operator notes. Always available; read it on your own at the start of a run.",
    category: "meta",
    scopes: ["read"],
    risk: "low",
    sandboxedToAgentFs: false,
  },
  {
    name: "context.write",
    label: "Update workspace context",
    description:
      "Create or replace CONTEXT.md. Use it to record durable facts (tech stack, layout, conventions) or to honour an operator instruction to include or remove something. Never write secrets.",
    category: "meta",
    scopes: ["write"],
    risk: "medium",
    sandboxedToAgentFs: false,
    argsHint: "{ content?: string, include?: string, remove?: string }",
  },
  {
    name: "task.handoff",
    label: "Hand off",
    description: "Return a structured summary to the orchestrator or a sibling.",
    category: "meta",
    scopes: ["read"],
    risk: "low",
    sandboxedToAgentFs: false,
  },
  {
    name: "agent.delegate",
    label: "Delegate",
    description:
      "Hand a bounded subtask to a child grunt that reports back to you. Use it when the work is narrower than the decision you owe: a lookup, a file read, a draft, or a check. Do not use it for the final decision, a credential, or your whole goal. If no child with that name exists, one is created under you and reused later.",
    category: "meta",
    scopes: ["read"],
    risk: "low",
    sandboxedToAgentFs: false,
    argsHint: "{ agent: string, title: string, task: string, tools?: string[], model?: string, complexity?: string }",
  },
  {
    name: "security.report",
    label: "Report finding",
    description: "Publish a reproducible security finding with severity and remediation.",
    category: "meta",
    scopes: ["write"],
    risk: "low",
    sandboxedToAgentFs: false,
    argsHint: "{ severity, category, title, detail, evidence, remediation }",
  },
  {
    name: "mcp.call",
    label: "MCP tool call",
    description: "Invoke a tool exposed by a connected MCP server.",
    category: "mcp",
    scopes: ["execute", "net"],
    risk: "high",
    sandboxedToAgentFs: false,
    argsHint: "{ server: string, tool: string, args: object }",
  },
  {
    name: "cli.run",
    label: "CLI",
    description: "Invoke an allowlisted internal binary.",
    category: "cli",
    scopes: ["execute"],
    risk: "high",
    sandboxedToAgentFs: false,
  },
  {
    name: "secret.use",
    label: "Use credential",
    description: "Mint a short-lived lease for a stored credential.",
    category: "meta",
    scopes: ["secret"],
    risk: "critical",
    sandboxedToAgentFs: false,
  },
];

export const TOOL_BY_NAME: ReadonlyMap<string, ToolManifestEntry> = new Map(
  TOOL_MANIFEST.map((t) => [t.name, t]),
);

export function toolsForRole(role: "orchestrator" | "worker" | "security"): ToolManifestEntry[] {
  switch (role) {
    case "orchestrator":
      return TOOL_MANIFEST.filter((t) =>
        ["meta", "knowledge", "filesystem"].includes(t.category),
      );
    case "security":
      return TOOL_MANIFEST.filter((t) =>
        ["knowledge", "network", "filesystem", "meta"].includes(t.category),
      );
    case "worker":
      return TOOL_MANIFEST.filter((t) => t.name !== "secret.use");
  }
}
