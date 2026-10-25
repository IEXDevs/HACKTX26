/**
 * Run event protocol.
 *
 * Every observable thing the runtime does is an event appended to a
 * per-run, monotonically-sequenced, hash-chained log. The UI, the eval
 * engine, the budget ledger and the audit trail are all projections over
 * this single stream — there is no second source of truth.
 */
import { z } from "zod";

export const EVENT_PROTOCOL_VERSION = 1 as const;

const ulidLike = z.string().min(1);
const isoDate = z.string().min(1);
const usd = z.number().finite();

export const AgentRoleSchema = z.enum(["orchestrator", "worker", "security"]);
export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "halted",
  "cancelled",
]);
export const TaskStatusSchema = z.enum([
  "pending",
  "running",
  "blocked",
  "succeeded",
  "failed",
  "skipped",
]);
export const ModelTierSchema = z.enum([
  "frontier",
  "balanced",
  "fast",
  "local",
]);
export const DataClassSchema = z.enum([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
export const RiskSchema = z.enum(["low", "medium", "high", "critical"]);
export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);

export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ModelTier = z.infer<typeof ModelTierSchema>;
export type DataClass = z.infer<typeof DataClassSchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type Severity = z.infer<typeof SeveritySchema>;

/* -------------------------------------------------------------------------- */
/* Payloads                                                                   */
/* -------------------------------------------------------------------------- */

const RunStarted = z.object({
  type: z.literal("run.started"),
  goal: z.string(),
  orchestratorAgentId: ulidLike,
  trigger: z.enum(["manual", "schedule", "webhook", "api"]),
  budgetUsd: usd,
  dataClass: DataClassSchema,
});

const RunCompleted = z.object({
  type: z.literal("run.completed"),
  status: RunStatusSchema,
  summary: z.string().optional(),
  reason: z.string().optional(),
  totalCostUsd: usd,
  durationMs: z.number().int().nonnegative(),
});

const TaskCreated = z.object({
  type: z.literal("task.created"),
  taskId: ulidLike,
  agentId: ulidLike,
  parentTaskId: ulidLike.nullable(),
  title: z.string(),
  detail: z.string().optional(),
});

const TaskUpdated = z.object({
  type: z.literal("task.updated"),
  taskId: ulidLike,
  status: TaskStatusSchema,
  note: z.string().optional(),
});

const AgentSpawned = z.object({
  type: z.literal("agent.spawned"),
  agentId: ulidLike,
  parentAgentId: ulidLike.nullable(),
  name: z.string(),
  role: AgentRoleSchema,
  model: z.string(),
});

const AgentStatus = z.object({
  type: z.literal("agent.status"),
  agentId: ulidLike,
  status: z.enum(["idle", "thinking", "working", "blocked", "done", "failed"]),
});

const AgentMessage = z.object({
  type: z.literal("agent.message"),
  agentId: ulidLike,
  role: z.enum(["assistant", "system", "user"]),
  text: z.string(),
  /** true for streaming deltas that will be superseded by a final message */
  delta: z.boolean().optional(),
});

const RouterDecision = z.object({
  type: z.literal("router.decision"),
  agentId: ulidLike,
  taskId: ulidLike.nullable(),
  chosenModel: z.string(),
  /** Resource envelope chosen from task complexity, when the runtime reports it. */
  hwTier: z.enum(["light", "medium", "heavy"]).optional(),
  reason: z.string(),
  estimatedCostUsd: usd,
  candidates: z
    .array(
      z.object({
        model: z.string(),
        score: z.number(),
        estimatedCostUsd: usd,
        rejectedReason: z.string().optional(),
      }),
    )
    .default([]),
});

const ToolRequested = z.object({
  type: z.literal("tool.requested"),
  callId: ulidLike,
  agentId: ulidLike,
  taskId: ulidLike.nullable(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  risk: RiskSchema,
  scopes: z.array(z.string()).default([]),
});

const ToolCompleted = z.object({
  type: z.literal("tool.completed"),
  callId: ulidLike,
  agentId: ulidLike,
  tool: z.string(),
  ok: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  resultPreview: z.string().optional(),
  error: z.string().optional(),
});

const PermissionRequested = z.object({
  type: z.literal("permission.requested"),
  approvalId: ulidLike,
  agentId: ulidLike,
  callId: ulidLike.nullable(),
  resource: z.string(),
  scopes: z.array(z.string()),
  risk: RiskSchema,
  reason: z.string(),
});

const PermissionResolved = z.object({
  type: z.literal("permission.resolved"),
  approvalId: ulidLike,
  decision: z.enum(["approved", "denied", "expired"]),
  decidedBy: z.string(),
  note: z.string().optional(),
});

const FileChanged = z.object({
  type: z.literal("file.changed"),
  agentId: ulidLike,
  path: z.string(),
  op: z.enum(["created", "updated", "deleted", "read"]),
  bytes: z.number().int().nonnegative().optional(),
});

const MemoryWritten = z.object({
  type: z.literal("memory.written"),
  agentId: ulidLike.nullable(),
  scope: z.enum(["workspace", "agent"]),
  kind: z.enum(["fact", "decision", "preference", "artifact"]),
  content: z.string(),
});

const BudgetWarning = z.object({
  type: z.literal("budget.warning"),
  scope: z.enum(["run", "agent", "workspace"]),
  spentUsd: usd,
  limitUsd: usd,
  threshold: z.number(),
});

const BudgetHalted = z.object({
  type: z.literal("budget.halted"),
  scope: z.enum(["run", "agent", "workspace"]),
  spentUsd: usd,
  limitUsd: usd,
});

const ModelUsage = z.object({
  type: z.literal("model.usage"),
  agentId: ulidLike,
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: usd,
});

const SecurityFinding = z.object({
  type: z.literal("security.finding"),
  findingId: ulidLike,
  agentId: ulidLike,
  targetAgentId: ulidLike.nullable(),
  category: z.enum([
    "prompt_injection",
    "data_exfiltration",
    "privilege_escalation",
    "secret_leak",
    "tool_abuse",
    "guardrail_bypass",
  ]),
  severity: SeveritySchema,
  title: z.string(),
  detail: z.string(),
  evidence: z.string().optional(),
  remediation: z.string().optional(),
});

const EvalScored = z.object({
  type: z.literal("eval.scored"),
  suiteId: ulidLike,
  caseId: z.string(),
  passed: z.boolean(),
  metrics: z.object({
    toolCallAccuracy: z.number().min(0).max(1).optional(),
    taskSuccess: z.number().min(0).max(1).optional(),
    interventions: z.number().int().nonnegative().optional(),
  }),
});

const LogLine = z.object({
  type: z.literal("log"),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  agentId: ulidLike.nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});

const Handoff = z.object({
  type: z.literal("handoff"),
  fromAgentId: ulidLike,
  toAgentId: ulidLike,
  summary: z.string(),
});

export const RunEventPayloadSchema = z.discriminatedUnion("type", [
  RunStarted,
  RunCompleted,
  TaskCreated,
  TaskUpdated,
  AgentSpawned,
  AgentStatus,
  AgentMessage,
  RouterDecision,
  ToolRequested,
  ToolCompleted,
  PermissionRequested,
  PermissionResolved,
  FileChanged,
  MemoryWritten,
  BudgetWarning,
  BudgetHalted,
  ModelUsage,
  SecurityFinding,
  EvalScored,
  LogLine,
  Handoff,
]);

export type RunEventPayload = z.infer<typeof RunEventPayloadSchema>;
export type RunEventType = RunEventPayload["type"];

/** Narrow a payload by its discriminant. */
export type EventOf<T extends RunEventType> = Extract<RunEventPayload, { type: T }>;

/** Fully materialised event as persisted and shipped over SSE. */
export const RunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  seq: z.number().int().nonnegative(),
  ts: isoDate,
  protocol: z.literal(EVENT_PROTOCOL_VERSION),
  payload: RunEventPayloadSchema,
  /** sha256(prevHash + canonical(payload)) — tamper-evident audit chain */
  hash: z.string(),
  prevHash: z.string(),
});

export type RunEvent = z.infer<typeof RunEventSchema>;

/** Envelope emitted over SSE. `heartbeat` keeps proxies from closing. */
export const StreamFrameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), event: RunEventSchema }),
  z.object({ kind: z.literal("heartbeat"), ts: isoDate }),
  z.object({ kind: z.literal("end"), status: RunStatusSchema }),
]);
export type StreamFrame = z.infer<typeof StreamFrameSchema>;

export const TERMINAL_RUN_STATUSES: ReadonlySet<z.infer<typeof RunStatusSchema>> =
  new Set(["succeeded", "failed", "halted", "cancelled"]);

export function isTerminalStatus(status: z.infer<typeof RunStatusSchema>): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}
