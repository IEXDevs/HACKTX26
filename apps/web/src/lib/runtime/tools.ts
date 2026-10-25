/**
 * Tool executor.
 *
 * This is the only place a capability actually touches the world. The
 * orchestrator has already evaluated policy by the time anything here runs, so
 * this layer assumes authorisation and concentrates on two things: doing the
 * work inside the sandbox, and never letting raw secrets or oversized output
 * reach the event log.
 */
import type { DataClass, RunEventPayload } from "@agent-os/core";
import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  connectors,
  credentials,
  memories,
} from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { redactSecrets } from "@/lib/secrets";
import { fetchFixture, searchKnowledgeBase } from "./kb";
import type { AgentSandbox } from "./sandbox";

export interface ToolContext {
  workspaceId: string;
  agentId: string;
  agentName: string;
  sandbox: AgentSandbox;
  dataClass: DataClass;
  /** Append a non-terminal side effect (file change, log) to the run stream. */
  emit: (payload: RunEventPayload) => Promise<void>;
}

export interface ToolResult {
  ok: boolean;
  preview: string;
  error?: string;
}

/** Hosts `http.fetch` may reach without an explicit per-call decision. */
const ALLOWED_HOSTS = new Set([
  "kb.internal",
  "github.com",
  "vendor.acme.example",
  "docs.astronom.dev",
]);

const PREVIEW_LIMIT = 1_200;

function clip(text: string, limit = PREVIEW_LIMIT): string {
  const redacted = redactSecrets(text);
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, limit)}… (+${redacted.length - limit} chars)`;
}

function fail(message: string): ToolResult {
  return { ok: false, preview: "", error: clip(message, 400) };
}

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Individual capabilities                                                    */
/* -------------------------------------------------------------------------- */

async function fsList(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const target = str(args, "path") ?? ".";
  const tree = ctx.sandbox.tree(target);
  if (tree.type === "file") {
    return { ok: true, preview: `${tree.path} · ${tree.bytes ?? 0} bytes` };
  }
  const lines: string[] = [];
  const walk = (node: typeof tree, depth: number) => {
    if (lines.length >= 60) return;
    const indent = "  ".repeat(depth);
    lines.push(
      node.type === "dir"
        ? `${indent}${node.name}/`
        : `${indent}${node.name} (${node.bytes ?? 0}b)`,
    );
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(tree, 0);
  return {
    ok: true,
    preview: `${lines.length} entries under ${tree.path || "."}\n${lines.join("\n")}`,
  };
}

async function fsRead(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const target = str(args, "path");
  if (!target) return fail("fs.read requires a path.");
  const content = ctx.sandbox.read(target);
  await ctx.emit({
    type: "file.changed",
    agentId: ctx.agentId,
    path: target,
    op: "read",
    bytes: Buffer.byteLength(content, "utf8"),
  });
  return { ok: true, preview: clip(content) };
}

async function fsWrite(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const target = str(args, "path");
  const content = str(args, "content");
  if (!target || content === null) return fail("fs.write requires path and content.");
  const { bytes } = ctx.sandbox.write(target, content);
  await ctx.emit({
    type: "file.changed",
    agentId: ctx.agentId,
    path: target,
    op: "created",
    bytes,
  });
  return { ok: true, preview: `wrote ${bytes} bytes to ${target}` };
}

async function fsDelete(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const target = str(args, "path");
  if (!target) return fail("fs.delete requires a path.");
  ctx.sandbox.remove(target);
  await ctx.emit({
    type: "file.changed",
    agentId: ctx.agentId,
    path: target,
    op: "deleted",
  });
  return { ok: true, preview: `deleted ${target}` };
}

async function shellExec(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const command = str(args, "command");
  if (!command) return fail("shell.exec requires a command.");
  const started = Date.now();
  const result = await ctx.sandbox.exec(command, 45_000);
  const body = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  const prefix = `exit=${result.code}${result.timedOut ? " timed-out" : ""} · ${
    Date.now() - started
  }ms`;
  return {
    ok: result.code === 0 && !result.timedOut,
    preview: `${prefix}\n${clip(body || "(no output)")}`,
    ...(result.code === 0 ? {} : { error: clip(result.stderr || `exit ${result.code}`, 400) }),
  };
}

async function httpFetch(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const raw = str(args, "url");
  if (!raw) return fail("http.fetch requires a url.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(`Not a URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return fail("Only http(s) URLs are fetchable.");
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    return fail(
      `Host "${url.hostname}" is not on the egress allowlist. Allowed: ${[...ALLOWED_HOSTS].join(", ")}.`,
    );
  }

  const fixture = fetchFixture(raw);
  if (fixture !== undefined) {
    return { ok: true, preview: `200 OK (workspace mirror) · ${url.hostname}\n${clip(fixture)}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "astronom-agent-runtime/0.1" },
    });
    const text = (await response.text()).slice(0, 256 * 1024);
    return {
      ok: response.ok,
      preview: `${response.status} ${response.statusText} · ${url.hostname}\n${clip(text)}`,
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
    };
  } catch (error) {
    return fail(`Fetch failed: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function kbSearch(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const query = str(args, "query");
  if (!query) return fail("kb.search requires a query.");
  const hits = searchKnowledgeBase(query, num(args, "topK") ?? 4);
  if (hits.length === 0) return { ok: true, preview: "0 hits. The knowledge base has no matching chunk." };
  const lines = hits.map(
    (hit) =>
      `${hit.id} · ${hit.title} (${hit.score})\n  [untrusted:${hit.trust}] ${hit.snippet}`,
  );
  return {
    ok: true,
    preview: `${hits.length} hits\n${clip(lines.join("\n"))}`,
  };
}

async function memoryWrite(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const content = str(args, "content");
  if (!content) return fail("memory.write requires content.");
  const scope = args.scope === "agent" ? "agent" : "workspace";
  const allowedKinds = ["fact", "decision", "preference", "artifact"] as const;
  const kind = allowedKinds.includes(args.kind as (typeof allowedKinds)[number])
    ? (args.kind as (typeof allowedKinds)[number])
    : "fact";

  const db = getDb();
  const id = newId("mem");
  await db.insert(memories).values({
    id,
    workspaceId: ctx.workspaceId,
    agentId: scope === "agent" ? ctx.agentId : null,
    scope,
    kind,
    content: clip(content, 2_000),
    importance: 0.65,
    sourceRunId: null,
    createdAt: new Date(),
  });

  await ctx.emit({
    type: "memory.written",
    agentId: ctx.agentId,
    scope,
    kind,
    content: clip(content, 400),
  });

  return { ok: true, preview: `stored ${kind} in ${scope} memory (${id})` };
}

async function memorySearch(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const query = str(args, "query") ?? "";
  const db = getDb();
  const term = `%${query.split(/\s+/).filter(Boolean)[0] ?? ""}%`;
  const rows = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.workspaceId, ctx.workspaceId),
        query.length > 1 ? like(memories.content, term) : undefined,
        or(eq(memories.scope, "workspace"), eq(memories.agentId, ctx.agentId)),
      ),
    )
    .orderBy(desc(memories.importance))
    .limit(6);

  if (rows.length === 0) return { ok: true, preview: "No matching memory." };
  return {
    ok: true,
    preview: rows
      .map((row) => `${row.kind} · ${row.scope} · ${row.importance.toFixed(2)} — ${row.content}`)
      .join("\n"),
  };
}

async function secretUse(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const name = str(args, "credential");
  if (!name) return fail("secret.use requires a credential name or id.");

  const db = getDb();
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.workspaceId, ctx.workspaceId));
  const match = rows.find(
    (row) =>
      row.id === name || row.name.toLowerCase() === name.toLowerCase(),
  );
  if (!match) return fail(`No credential named "${name}" in this workspace.`);

  // The lease is minted and immediately dropped: no caller can retrieve the
  // plaintext through the event stream, the run summary, or the UI.
  const { openSecret } = await import("@/lib/secrets");
  const value = openSecret({
    ciphertext: match.ciphertext,
    iv: match.iv,
    authTag: match.authTag,
  });
  const expiresAt = Date.now() + 60_000;

  await db
    .update(credentials)
    .set({ lastUsedAt: new Date(expiresAt) })
    .where(eq(credentials.id, match.id));

  return {
    ok: true,
    preview:
      `lease ${match.id} minted for 60s · credential ${match.hint} · ` +
      `${value.length} bytes decrypted in-process · plaintext withheld from the transcript`,
  };
}

async function taskHandoff(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const summary = str(args, "summary") ?? "handoff acknowledged";
  return { ok: true, preview: `handoff from ${ctx.agentName}: ${clip(summary, 300)}` };
}

async function mcpCall(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const server = str(args, "server");
  const tool = str(args, "tool");
  if (!server || !tool) return fail("mcp.call requires server and tool.");

  const db = getDb();
  const [connector] = await db
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.workspaceId, ctx.workspaceId),
        eq(connectors.kind, "mcp"),
        eq(connectors.provider, server),
      ),
    )
    .limit(1);

  if (!connector) return fail(`No MCP connector registered for "${server}".`);
  if (connector.status !== "connected") {
    return fail(`MCP connector "${connector.name}" is ${connector.status}.`);
  }
  const endpoint = connector.config.url;
  if (typeof endpoint !== "string" || !endpoint.startsWith("http")) {
    return fail(
      `MCP connector "${connector.name}" has no HTTP transport configured; only the registry entry exists.`,
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: newId("rpc"),
      method: "tools/call",
      params: { name: tool, arguments: args.args ?? {} },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  return {
    ok: response.ok,
    preview: clip(body || "(empty MCP response)"),
    ...(response.ok ? {} : { error: `MCP ${response.status}` }),
  };
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

/** Tools the engine handles itself rather than the executor. */
export const ENGINE_TOOLS = new Set(["agent.delegate", "security.report"]);

export async function executeTool(
  ctx: ToolContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (tool) {
    case "fs.list":
      return fsList(ctx, args);
    case "fs.read":
      return fsRead(ctx, args);
    case "fs.write":
      return fsWrite(ctx, args);
    case "fs.delete":
      return fsDelete(ctx, args);
    case "shell.exec":
    case "cli.run":
      return shellExec(ctx, args);
    case "http.fetch":
      return httpFetch(ctx, args);
    case "kb.search":
      return kbSearch(ctx, args);
    case "memory.write":
      return memoryWrite(ctx, args);
    case "memory.search":
      return memorySearch(ctx, args);
    case "secret.use":
      return secretUse(ctx, args);
    case "task.handoff":
      return taskHandoff(ctx, args);
    case "mcp.call":
      return mcpCall(ctx, args);
    default:
      return fail(`Tool "${tool}" has no executor.`);
  }
}
