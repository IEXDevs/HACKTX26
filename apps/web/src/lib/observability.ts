/**
 * Cloud ledger for real model usage, prompt traces, and platform activity.
 * Writes are best-effort: a downed Supabase must never fail a run.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MODEL_BY_ID, estimateCostUsd } from "@agent-os/core";
import { env, observabilityEnabled } from "./env";
import { redactSecrets } from "./secrets";
import type { ModelMessage } from "./runtime/types";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null | undefined;

function admin(): SupabaseClient | null {
  if (!observabilityEnabled()) return null;
  if (adminClient !== undefined) return adminClient;
  adminClient = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export type TelemetrySource = "run" | "builder" | "compose";

export interface ModelTurn {
  workspaceId: string;
  userId?: string | null;
  source: TelemetrySource;
  runId?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  model: string;
  step?: number;
  messages: Array<Pick<ModelMessage, "role" | "content">>;
  completion?: string;
  thinking?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  dataClass?: string | null;
}

export interface ActivityEventInput {
  workspaceId: string;
  userId?: string | null;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  detail?: Record<string, unknown>;
}

const TOOL_CLIP = 400;
const MESSAGE_CLIP = 4_000;
const TOTAL_CLIP = 24_000;
const COMPLETION_CLIP = 8_000;

export function clipText(text: string, max: number): string {
  const redacted = redactSecrets(text);
  if (redacted.length <= max) return redacted;
  return `${redacted.slice(0, max)}…[+${redacted.length - max} chars]`;
}

export function sanitizeMessages(
  messages: Array<Pick<ModelMessage, "role" | "content">>,
): Array<{ role: string; content: string; chars: number }> {
  const out: Array<{ role: string; content: string; chars: number }> = [];
  let used = 0;
  for (const message of messages) {
    const cap = message.role === "tool" ? TOOL_CLIP : MESSAGE_CLIP;
    const remaining = Math.max(80, TOTAL_CLIP - used);
    const content = clipText(message.content ?? "", Math.min(cap, remaining));
    used += content.length;
    out.push({ role: message.role, content, chars: (message.content ?? "").length });
    if (used >= TOTAL_CLIP) break;
  }
  return out;
}

export function contentHash(messages: Array<{ content: string }>, completion = ""): string {
  const hash = createHash("sha256");
  for (const message of messages) hash.update(message.content);
  hash.update("\n");
  hash.update(completion);
  return hash.digest("hex");
}

export function costForModel(modelId: string, inputTokens: number, outputTokens: number): number {
  const model = MODEL_BY_ID.get(modelId);
  if (model) return Number(estimateCostUsd(model, inputTokens, outputTokens).toFixed(6));
  return Number(((inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15).toFixed(6));
}

function warn(scope: string, error: unknown): void {
   
  console.warn(`[observability] ${scope}:`, error instanceof Error ? error.message : error);
}

function isPrivilegeError(message: string): boolean {
  return /permission denied|42501/i.test(message);
}

function fallbackFile(table: string): string {
  const dir = path.resolve(process.cwd(), ".data");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${table}.jsonl`);
}

function appendFallback(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const record = {
    id: typeof row.id === "string" ? row.id : randomUUID(),
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    ...row,
  };
  fs.appendFileSync(fallbackFile(table), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

function readFallback(table: string): Array<Record<string, unknown>> {
  const file = fallbackFile(table);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

async function insert(table: string, row: Record<string, unknown>): Promise<void> {
  if (!observabilityEnabled()) return;
  const client = admin();
  if (!client) return;
  const { error } = await client.from(table).insert(row);
  if (!error) return;
  if (isPrivilegeError(error.message)) {
    appendFallback(table, row);
    return;
  }
  warn(`insert ${table}`, error.message);
}

export async function recordModelTurn(turn: ModelTurn): Promise<void> {
  if (!observabilityEnabled()) return;
  if (turn.inputTokens <= 0 && turn.outputTokens <= 0 && !turn.completion && !turn.thinking?.trim())
    return;
  const messages = sanitizeMessages(turn.messages);
  if (turn.thinking?.trim()) {
    messages.push({
      role: "thinking",
      content: clipText(turn.thinking.trim(), MESSAGE_CLIP),
      chars: turn.thinking.length,
    });
  }
  const completion = turn.completion ? clipText(turn.completion, COMPLETION_CLIP) : null;
  const costUsd = turn.costUsd ?? costForModel(turn.model, turn.inputTokens, turn.outputTokens);
  const hash = contentHash(turn.messages, turn.completion ?? "");
  try {
    await Promise.all([
      insert("usage_events", {
        workspace_id: turn.workspaceId,
        user_id: turn.userId ?? null,
        source: turn.source,
        run_id: turn.runId ?? null,
        agent_id: turn.agentId ?? null,
        agent_name: turn.agentName ?? null,
        model: turn.model,
        input_tokens: turn.inputTokens,
        output_tokens: turn.outputTokens,
        cost_usd: costUsd,
        data_class: turn.dataClass ?? null,
      }),
      insert("prompt_logs", {
        workspace_id: turn.workspaceId,
        user_id: turn.userId ?? null,
        source: turn.source,
        run_id: turn.runId ?? null,
        agent_id: turn.agentId ?? null,
        model: turn.model,
        step: turn.step ?? null,
        messages,
        completion,
        input_tokens: turn.inputTokens,
        output_tokens: turn.outputTokens,
        content_hash: hash,
      }),
    ]);
  } catch (error) {
    warn("recordModelTurn", error);
  }
}

export async function recordActivity(event: ActivityEventInput): Promise<void> {
  try {
    await insert("activity_events", {
      workspace_id: event.workspaceId,
      user_id: event.userId ?? null,
      actor: event.actor,
      action: event.action,
      target_type: event.targetType,
      target_id: event.targetId,
      detail: event.detail ?? {},
    });
  } catch (error) {
    warn("recordActivity", error);
  }
}

export async function touchProfile(userId: string): Promise<void> {
  if (!observabilityEnabled()) return;
  const client = admin();
  if (!client) return;
  const { error } = await client
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", userId);
  if (error && !isPrivilegeError(error.message)) warn("touchProfile", error.message);
}

export interface CloudUsageRow {
  source: TelemetrySource;
  runId: string | null;
  agentId: string | null;
  agentName: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: Date;
}

export interface CloudPromptRow {
  id: string;
  source: TelemetrySource;
  runId: string | null;
  agentId: string | null;
  model: string | null;
  step: number | null;
  messages: Array<{ role: string; content: string; chars: number }>;
  completion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: Date;
}

function sinceDate(range: "24h" | "7d" | "all"): string | null {
  const now = Date.now();
  if (range === "24h") return new Date(now - 24 * 3600e3).toISOString();
  if (range === "7d") return new Date(now - 7 * 24 * 3600e3).toISOString();
  return null;
}

export async function listUsageEvents(
  workspaceId: string,
  range: "24h" | "7d" | "all" = "7d",
): Promise<CloudUsageRow[] | null> {
  if (!observabilityEnabled()) return null;
  const client = admin();
  if (!client) return null;
  let query = client
    .from("usage_events")
    .select(
      "source, run_id, agent_id, agent_name, model, input_tokens, output_tokens, cost_usd, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(5_000);
  const since = sinceDate(range);
  if (since) query = query.gte("created_at", since);
  const { data, error } = await query;
  const rows = error
    ? isPrivilegeError(error.message)
      ? readFallback("usage_events").filter((row) => {
          if (row.workspace_id !== workspaceId) return false;
          return !since || String(row.created_at) >= since;
        })
      : (warn("listUsageEvents", error.message), null)
    : (data ?? []);
  if (!rows) return null;
  return rows.map((row) => ({
    source: row.source as TelemetrySource,
    runId: (row.run_id as string | null) ?? null,
    agentId: (row.agent_id as string | null) ?? null,
    agentName: (row.agent_name as string | null) ?? null,
    model: String(row.model ?? ""),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    createdAt: new Date(String(row.created_at)),
  }));
}

export async function listPromptLogs(
  workspaceId: string,
  limit = 80,
): Promise<CloudPromptRow[] | null> {
  if (!observabilityEnabled()) return null;
  const client = admin();
  if (!client) return null;
  const { data, error } = await client
    .from("prompt_logs")
    .select(
      "id, source, run_id, agent_id, model, step, messages, completion, input_tokens, output_tokens, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = error
    ? isPrivilegeError(error.message)
      ? readFallback("prompt_logs")
          .filter((row) => row.workspace_id === workspaceId)
          .reverse()
          .slice(0, limit)
      : (warn("listPromptLogs", error.message), null)
    : (data ?? []);
  if (!rows) return null;
  return rows.map((row) => ({
    id: String(row.id),
    source: row.source as TelemetrySource,
    runId: (row.run_id as string | null) ?? null,
    agentId: (row.agent_id as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    step: (row.step as number | null) ?? null,
    messages: Array.isArray(row.messages) ? row.messages : [],
    completion: (row.completion as string | null) ?? null,
    inputTokens: (row.input_tokens as number | null) ?? null,
    outputTokens: (row.output_tokens as number | null) ?? null,
    createdAt: new Date(String(row.created_at)),
  }));
}

export async function spendSince(workspaceId: string, since: Date): Promise<number | null> {
  if (!observabilityEnabled()) return null;
  const client = admin();
  if (!client) return null;
  // Filter by date in the query: fetching all rows and filtering here dropped
  // recent spend once a workspace passed the row limit.
  const { data, error } = await client
    .from("usage_events")
    .select("cost_usd")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .limit(5_000);
  if (error) {
    warn("spendSince", error.message);
    return null;
  }
  return (data ?? []).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
}
