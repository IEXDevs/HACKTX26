/**
 * Cloud ledger for real model usage, prompt traces, auth, and platform
 * activity. Writes are best-effort: a downed Supabase must never fail a run.
 */
import { createHash } from "node:crypto";
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
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  dataClass?: string | null;
}

export interface AuthEventInput {
  userId?: string | null;
  email?: string | null;
  event: "signed_in" | "signed_out" | "login_failed" | "token_refreshed";
  provider?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
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
  // eslint-disable-next-line no-console
  console.warn(`[observability] ${scope}:`, error instanceof Error ? error.message : error);
}

async function insert(table: string, row: Record<string, unknown>): Promise<void> {
  if (!observabilityEnabled()) return;
  const client = admin();
  if (!client) return;
  const { error } = await client.from(table).insert(row);
  if (error) warn(`insert ${table}`, error.message);
}

export async function recordModelTurn(turn: ModelTurn): Promise<void> {
  if (!observabilityEnabled()) return;
  if (turn.inputTokens <= 0 && turn.outputTokens <= 0 && !turn.completion) return;
  const messages = sanitizeMessages(turn.messages);
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

export async function recordAuthEvent(event: AuthEventInput): Promise<void> {
  try {
    await insert("auth_events", {
      user_id: event.userId ?? null,
      email: event.email ?? null,
      event: event.event,
      provider: event.provider ?? null,
      ip: event.ip ?? null,
      user_agent: event.userAgent ?? null,
      metadata: event.metadata ?? {},
    });
  } catch (error) {
    warn("recordAuthEvent", error);
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
  if (error) warn("touchProfile", error.message);
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

export interface CloudAuthRow {
  id: string;
  email: string | null;
  event: string;
  provider: string | null;
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
  if (error) {
    warn("listUsageEvents", error.message);
    return null;
  }
  return (data ?? []).map((row) => ({
    source: row.source as TelemetrySource,
    runId: row.run_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    model: row.model,
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    createdAt: new Date(row.created_at),
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
  if (error) {
    warn("listPromptLogs", error.message);
    return null;
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    source: row.source as TelemetrySource,
    runId: row.run_id,
    agentId: row.agent_id,
    model: row.model,
    step: row.step,
    messages: Array.isArray(row.messages) ? row.messages : [],
    completion: row.completion,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: new Date(row.created_at),
  }));
}

export async function listAuthEvents(limit = 40): Promise<CloudAuthRow[] | null> {
  if (!observabilityEnabled()) return null;
  const client = admin();
  if (!client) return null;
  const { data, error } = await client
    .from("auth_events")
    .select("id, email, event, provider, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    warn("listAuthEvents", error.message);
    return null;
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    event: row.event,
    provider: row.provider,
    createdAt: new Date(row.created_at),
  }));
}

export async function spendSince(workspaceId: string, since: Date): Promise<number | null> {
  const rows = await listUsageEvents(workspaceId, "all");
  if (!rows) return null;
  return rows
    .filter((row) => row.createdAt.getTime() >= since.getTime())
    .reduce((sum, row) => sum + row.costUsd, 0);
}
