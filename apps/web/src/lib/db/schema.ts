import type {
  AgentRole,
  BudgetPolicy,
  DataClass,
  ModelPolicy,
  PermissionGrant,
  PromptBlock,
  Risk,
  RunEventPayload,
  RunStatus,
  Severity,
  TaskComplexity,
  Trigger,
} from "@agent-os/core";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/* -------------------------------------------------------------------------- */
/* Tenancy                                                                    */
/* -------------------------------------------------------------------------- */

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Default classification applied to new agents and runs. */
  defaultDataClass: text("default_data_class").$type<DataClass>().notNull().default("internal"),
  /** Models the org forbids the router from selecting. */
  deniedModelIds: text("denied_model_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  defaultRunBudgetUsd: real("default_run_budget_usd").notNull().default(2.5),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role", { enum: ["owner", "admin", "engineer", "viewer"] })
      .notNull()
      .default("engineer"),
    avatarHue: integer("avatar_hue").notNull().default(90),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/* -------------------------------------------------------------------------- */
/* Builder: templates, prompts, agents                                        */
/* -------------------------------------------------------------------------- */

export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    /** What the template actually does, in one line, for the gallery card. */
    outcome: text("outcome").notNull(),
    graph: text("graph", { mode: "json" })
      .$type<{
        orchestrator: { name: string; instructions: string; complexity: TaskComplexity };
        workers: Array<{
          name: string;
          role: AgentRole;
          instructions: string;
          complexity: TaskComplexity;
          tools: string[];
        }>;
      }>()
      .notNull(),
    requiredConnectors: text("required_connectors", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    estimatedMinutes: integer("estimated_minutes").notNull().default(5),
    builtin: integer("builtin", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("templates_key_idx").on(t.key)],
);

export const promptBlocks = sqliteTable("prompt_blocks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  level: text("level").$type<PromptBlock["level"]>().notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    role: text("role").$type<AgentRole>().notNull(),
    parentAgentId: text("parent_agent_id"),
    summary: text("summary").notNull().default(""),
    instructions: text("instructions").notNull(),
    inheritedPromptBlockIds: text("inherited_prompt_block_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    modelPolicy: text("model_policy", { mode: "json" }).$type<ModelPolicy>().notNull(),
    grants: text("grants", { mode: "json" })
      .$type<PermissionGrant[]>()
      .notNull()
      .default(sql`'[]'`),
    allowedTools: text("allowed_tools", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    complexity: text("complexity").$type<TaskComplexity>().notNull().default("standard"),
    maxSteps: integer("max_steps").notNull().default(12),
    dataClass: text("data_class").$type<DataClass>().notNull().default("internal"),
    status: text("status", { enum: ["draft", "active", "paused", "archived"] })
      .notNull()
      .default("draft"),
    version: integer("version").notNull().default(1),
    templateId: text("template_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    /**
     * First-run goal drafted from the builder use case. Empty for agents that
     * were seeded or instantiated from a template. Dispatch prefills from this.
     */
    defaultGoal: text("default_goal").notNull().default(""),
  },
  (t) => [
    uniqueIndex("agents_workspace_slug_idx").on(t.workspaceId, t.slug),
    index("agents_parent_idx").on(t.parentAgentId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Connectors + credential vault                                              */
/* -------------------------------------------------------------------------- */

export const connectors = sqliteTable("connectors", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["mcp", "api", "cli", "rag", "web"] }).notNull(),
  provider: text("provider").notNull(),
  description: text("description").notNull().default(""),
  config: text("config", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  status: text("status", { enum: ["connected", "degraded", "disconnected"] })
    .notNull()
    .default("disconnected"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  connectorId: text("connector_id"),
  name: text("name").notNull(),
  /** AES-256-GCM ciphertext. The plaintext never touches this table. */
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  /** Non-secret display hint, e.g. `ghp_…4f2a`. */
  hint: text("hint").notNull(),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  rotatedAt: integer("rotated_at", { mode: "timestamp_ms" }),
});

/* -------------------------------------------------------------------------- */
/* Execution: runs + append-only event log                                    */
/* -------------------------------------------------------------------------- */

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    triggerId: text("trigger_id"),
    goal: text("goal").notNull(),
    status: text("status").$type<RunStatus>().notNull().default("queued"),
    dataClass: text("data_class").$type<DataClass>().notNull().default("internal"),
    budgetUsd: real("budget_usd").notNull(),
    costUsd: real("cost_usd").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    summary: text("summary"),
    failureReason: text("failure_reason"),
    /** How the run was produced — surfaced in the UI so nothing is ambiguous. */
    mode: text("mode", { enum: ["live", "scripted", "replay"] }).notNull().default("live"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    eventCount: integer("event_count").notNull().default(0),
  },
  (t) => [
    index("runs_workspace_started_idx").on(t.workspaceId, t.startedAt),
    index("runs_agent_idx").on(t.agentId),
  ],
);

/**
 * Append-only. No UPDATE or DELETE is ever issued against this table: the
 * `hash` chain makes an out-of-band mutation detectable, and `seq` is unique
 * per run so a replay is a simple ordered read.
 */
export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    ts: integer("ts", { mode: "timestamp_ms" }).notNull(),
    type: text("type").notNull(),
    agentId: text("agent_id"),
    hash: text("hash").notNull(),
    prevHash: text("prev_hash").notNull(),
    payload: text("payload", { mode: "json" }).$type<RunEventPayload>().notNull(),
  },
  (t) => [
    uniqueIndex("run_events_run_seq_idx").on(t.runId, t.seq),
    index("run_events_type_idx").on(t.type),
  ],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    agentId: text("agent_id").notNull(),
    callId: text("call_id"),
    resource: text("resource").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    risk: text("risk").$type<Risk>().notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["pending", "approved", "denied", "expired"] })
      .notNull()
      .default("pending"),
    decidedBy: text("decided_by"),
    note: text("note"),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("approvals_status_idx").on(t.workspaceId, t.status)],
);

/* -------------------------------------------------------------------------- */
/* Memory + workspace task log                                                */
/* -------------------------------------------------------------------------- */

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id"),
    scope: text("scope", { enum: ["workspace", "agent"] }).notNull().default("workspace"),
    kind: text("kind", { enum: ["fact", "decision", "preference", "artifact"] }).notNull(),
    content: text("content").notNull(),
    /** 0–1, bumped when an agent recalls it. Drives eviction. */
    importance: real("importance").notNull().default(0.5),
    sourceRunId: text("source_run_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastRecalledAt: integer("last_recalled_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("memories_workspace_idx").on(t.workspaceId, t.scope)],
);

/**
 * The human-readable task ledger for a workspace. Written when a run
 * terminates; complements (never replaces) the raw event log.
 */
export const taskLog = sqliteTable(
  "task_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    agentId: text("agent_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    status: text("status").$type<RunStatus>().notNull(),
    costUsd: real("cost_usd").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("task_log_workspace_idx").on(t.workspaceId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Security + evaluations                                                     */
/* -------------------------------------------------------------------------- */

export const securityFindings = sqliteTable(
  "security_findings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    agentId: text("agent_id").notNull(),
    targetAgentId: text("target_agent_id"),
    category: text("category").notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    evidence: text("evidence"),
    remediation: text("remediation"),
    status: text("status", { enum: ["open", "accepted", "fixed", "false_positive"] })
      .notNull()
      .default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("findings_workspace_idx").on(t.workspaceId, t.severity)],
);

export const evalSuites = sqliteTable("eval_suites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  cases: text("cases", { mode: "json" })
    .$type<Array<{ id: string; name: string; input: string; expectedTools: string[] }>>()
    .notNull()
    .default(sql`'[]'`),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const evalRuns = sqliteTable(
  "eval_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    suiteId: text("suite_id").notNull(),
    /** Optional link to the production run that triggered the eval. */
    runId: text("run_id"),
    status: text("status", { enum: ["running", "passed", "failed"] }).notNull(),
    toolCallAccuracy: real("tool_call_accuracy").notNull().default(0),
    taskSuccess: real("task_success").notNull().default(0),
    interventionRate: real("intervention_rate").notNull().default(0),
    casesPassed: integer("cases_passed").notNull().default(0),
    casesTotal: integer("cases_total").notNull().default(0),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("eval_runs_suite_idx").on(t.suiteId, t.startedAt)],
);

/* -------------------------------------------------------------------------- */
/* Triggers, budgets, audit                                                   */
/* -------------------------------------------------------------------------- */

export const triggers = sqliteTable("triggers", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  kind: text("kind").$type<Trigger["kind"]>().notNull(),
  cron: text("cron"),
  eventFilter: text("event_filter"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastFiredAt: integer("last_fired_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const budgetPolicies = sqliteTable("budget_policies", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** null = workspace-wide policy. */
  agentId: text("agent_id"),
  period: text("period").$type<BudgetPolicy["period"]>().notNull(),
  limitUsd: real("limit_usd").notNull(),
  warnAt: real("warn_at").notNull().default(0.8),
  hardStop: integer("hard_stop", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Configuration changes, credential access and approval decisions land here.
 * Run execution goes to `run_events`; everything that *mutates the platform*
 * goes here. Together they cover the audit surface.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    detail: text("detail", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("audit_workspace_idx").on(t.workspaceId, t.at)],
);

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type Workspace = typeof workspaces.$inferSelect;
export type User = typeof users.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type PromptBlockRow = typeof promptBlocks.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type Connector = typeof connectors.$inferSelect;
export type CredentialRow = typeof credentials.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type MemoryRow = typeof memories.$inferSelect;
export type TaskLogRow = typeof taskLog.$inferSelect;
export type SecurityFindingRow = typeof securityFindings.$inferSelect;
export type EvalSuiteRow = typeof evalSuites.$inferSelect;
export type EvalRunRow = typeof evalRuns.$inferSelect;
export type TriggerRow = typeof triggers.$inferSelect;
export type BudgetPolicyRow = typeof budgetPolicies.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
