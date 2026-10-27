import type {
  AgentRank,
  AgentRole,
  ApprovalMode,
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
import { FINDING_STATUSES } from "../loop/lifecycle";
import {
  index,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  timestamp,
  pgSchema,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Tenancy                                                                    */
/* -------------------------------------------------------------------------- */

export const appSchema = pgSchema("astronom");

export const workspaces = appSchema.table("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Default classification applied to new agents and runs. */
  defaultDataClass: text("default_data_class").$type<DataClass>().notNull().default("internal"),
  /** Models the org forbids the router from selecting. */
  deniedModelIds: jsonb("denied_model_ids")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  defaultRunBudgetUsd: doublePrecision("default_run_budget_usd").notNull().default(2.5),
  approvalMode: text("approval_mode").$type<ApprovalMode>().notNull().default("request"),
  /**
   * Operator-set access levels for the six named actions (fs.read, fs.write,
   * http.fetch, shell.exec, secret.use, cli:prod-deploy). Empty means defaults.
   */
  actionEffects: jsonb("action_effects")
    .$type<Record<string, "allow" | "allow_with_log" | "require_approval" | "deny">>()
    .notNull()
    .default(sql`'{}'`),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}).enableRLS();

export const users = appSchema.table(
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
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/* Builder: templates, prompts, agents                                        */
/* -------------------------------------------------------------------------- */

export const templates = appSchema.table(
  "templates",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    /** What the template actually does, in one line, for the gallery card. */
    outcome: text("outcome").notNull(),
    graph: jsonb("graph")
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
    requiredConnectors: jsonb("required_connectors")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'`),
    estimatedMinutes: integer("estimated_minutes").notNull().default(5),
    builtin: boolean("builtin").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [uniqueIndex("templates_key_idx").on(t.key)],
).enableRLS();

export const templateProposals = appSchema.table(
  "template_proposals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentAgentId: text("parent_agent_id").notNull(),
    runId: text("run_id"),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    instructions: text("instructions").notNull(),
    tools: jsonb("tools").$type<string[]>().notNull().default(sql`'[]'`),
    role: text("role").$type<AgentRole>().notNull(),
    complexity: text("complexity").$type<TaskComplexity>().notNull().default("standard"),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["pending", "saved", "dismissed"] })
      .notNull()
      .default("pending"),
    templateId: text("template_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("template_proposals_parent_idx").on(t.parentAgentId)],
).enableRLS();

export const promptBlocks = appSchema.table("prompt_blocks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  level: text("level").$type<PromptBlock["level"]>().notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  locked: boolean("locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}).enableRLS();

export const agents = appSchema.table(
  "agents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    role: text("role").$type<AgentRole>().notNull(),
    rank: text("rank").$type<AgentRank>().notNull().default("grunt"),
    /** When set, this agent may create a child one rank below. Grunts cannot. */
    canSpawnSubagents: boolean("can_spawn_subagents").notNull().default(false),
    parentAgentId: text("parent_agent_id"),
    summary: text("summary").notNull().default(""),
    instructions: text("instructions").notNull(),
    inheritedPromptBlockIds: jsonb("inherited_prompt_block_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    modelPolicy: jsonb("model_policy").$type<ModelPolicy>().notNull(),
    grants: jsonb("grants")
      .$type<PermissionGrant[]>()
      .notNull()
      .default(sql`'[]'`),
    allowedTools: jsonb("allowed_tools")
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
    /** Library agent used by this workflow instance. Library definitions stay unchanged. */
    sourceAgentId: text("source_agent_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    /**
     * First-run goal drafted from the builder use case. Empty for agents that
     * were seeded or instantiated from a template. Dispatch prefills from this.
     */
    defaultGoal: text("default_goal").notNull().default(""),
    /** When set, reusable children are filed as templates the operator must approve. */
    proposeTemplates: boolean("propose_templates").notNull().default(false),
    /**
     * Red attacks agents, blue repairs them (lib/loop/blue-team.ts). One value
     * per agent, so a blue agent and a red agent are never the same instance.
     */
    team: text("team", { enum: ["red", "blue"] }),
    /**
     * Composio toolkit slugs (plus `serpapi`) this agent may call. Orchestrators
     * ignore this and receive every app the current operator has linked.
     * Grunts only get what the parent passed on `agent.delegate`.
     */
    allowedConnectors: jsonb("allowed_connectors")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
  },
  (t) => [
    uniqueIndex("agents_workspace_slug_idx").on(t.workspaceId, t.slug),
    index("agents_parent_idx").on(t.parentAgentId),
  ],
).enableRLS();

/* -------------------------------------------------------------------------- */
/* Connectors + credential vault                                              */
/* -------------------------------------------------------------------------- */

export const connectors = appSchema.table("connectors", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["mcp", "api", "cli", "rag", "web"] }).notNull(),
  provider: text("provider").notNull(),
  description: text("description").notNull().default(""),
  config: jsonb("config")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  status: text("status", { enum: ["connected", "degraded", "disconnected"] })
    .notNull()
    .default("disconnected"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}).enableRLS();

export const connectedAccounts = appSchema.table(
  "connected_accounts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    toolkit: text("toolkit").notNull(),
    toolkitName: text("toolkit_name").notNull(),
    composioAccountId: text("composio_account_id"),
    authConfigId: text("auth_config_id"),
    status: text("status", { enum: ["connected", "pending", "disconnected", "error"] })
      .notNull()
      .default("disconnected"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'`),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [uniqueIndex("connected_accounts_user_toolkit_idx").on(t.workspaceId, t.userId, t.toolkit)],
).enableRLS();

export const connectorGrants = appSchema.table(
  "connector_grants",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    toolkit: text("toolkit").notNull(),
    grantedBy: text("granted_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [uniqueIndex("connector_grants_agent_toolkit_idx").on(t.agentId, t.toolkit)],
).enableRLS();

export const workspaceContexts = appSchema.table("workspace_contexts", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
}).enableRLS();

export const connectorCatalog = appSchema.table("connector_catalog", {
  toolkit: text("toolkit").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  logoUrl: text("logo_url"),
  category: text("category"),
  authSchemes: jsonb("auth_schemes").$type<string[]>().notNull().default(sql`'[]'`),
  popular: boolean("popular").notNull().default(false),
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
}).enableRLS();

export const credentials = appSchema.table("credentials", {
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
  scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'`),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  rotatedAt: timestamp("rotated_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  uniqueIndex("credentials_account_muse_idx").on(t.createdBy).where(sql`${t.connectorId} = 'muse'`),
  uniqueIndex("credentials_account_gemini_idx").on(t.createdBy).where(sql`${t.connectorId} = 'gemini'`),
]).enableRLS();

/** Documents people add for agents to search. Nothing is preloaded. */
export const kbDocuments = appSchema.table(
  "kb_documents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dataClass: text("data_class").$type<DataClass>().notNull().default("internal"),
    body: text("body").notNull(),
    addedBy: text("added_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("kb_documents_workspace_idx").on(t.workspaceId)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/* Execution: runs + append-only event log                                    */
/* -------------------------------------------------------------------------- */

export const runs = appSchema.table(
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
    budgetUsd: doublePrecision("budget_usd").notNull(),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    summary: text("summary"),
    failureReason: text("failure_reason"),
    /** How the run was produced — surfaced in the UI so nothing is ambiguous. */
    mode: text("mode", { enum: ["live", "scripted", "replay"] }).notNull().default("live"),
    /** "retest" runs carry synthetic test data: no memory writes, no real secrets. */
    purpose: text("purpose", { enum: ["standard", "retest"] }).notNull().default("standard"),
    /** Composio / SerpAPI identity for this run (Supabase user id or `local:…`). */
    operatorUserId: text("operator_user_id"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    eventCount: integer("event_count").notNull().default(0),
    /** Written every few seconds while a server process runs this run. See lib/runtime/reaper.ts. */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" }),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
  },
  (t) => [
    index("runs_workspace_started_idx").on(t.workspaceId, t.startedAt),
    index("runs_agent_idx").on(t.agentId),
  ],
).enableRLS();

/**
 * Append-only. No UPDATE or DELETE is ever issued against this table: the
 * `hash` chain makes an out-of-band mutation detectable, and `seq` is unique
 * per run so a replay is a simple ordered read.
 */
export const runEvents = appSchema.table(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    type: text("type").notNull(),
    agentId: text("agent_id"),
    hash: text("hash").notNull(),
    prevHash: text("prev_hash").notNull(),
    payload: jsonb("payload").$type<RunEventPayload>().notNull(),
  },
  (t) => [
    uniqueIndex("run_events_run_seq_idx").on(t.runId, t.seq),
    index("run_events_type_idx").on(t.type),
  ],
).enableRLS();

export const inputRequests = appSchema.table("input_requests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  callId: text("call_id").notNull(),
  question: text("question").notNull(),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["pending", "answered", "cancelled"] }).notNull().default("pending"),
  answer: text("answer"),
  answeredBy: text("answered_by"),
  requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true, mode: "date" }),
}, (t) => [index("input_requests_workspace_status_idx").on(t.workspaceId, t.status), uniqueIndex("input_requests_run_call_idx").on(t.runId, t.callId)]).enableRLS();

export const runCheckpoints = appSchema.table("run_checkpoints", {
  runId: text("run_id").primaryKey().references(() => runs.id, { onDelete: "cascade" }),
  state: jsonb("state").$type<import("../runtime/run-input").RunContinuation>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
}).enableRLS();

export const approvals = appSchema.table(
  "approvals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    agentId: text("agent_id").notNull(),
    callId: text("call_id"),
    resource: text("resource").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    risk: text("risk").$type<Risk>().notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["pending", "approved", "denied", "expired"] })
      .notNull()
      .default("pending"),
    decidedBy: text("decided_by"),
    note: text("note"),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("approvals_status_idx").on(t.workspaceId, t.status)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/* Memory + workspace task log                                                */
/* -------------------------------------------------------------------------- */

export const memories = appSchema.table(
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
    importance: doublePrecision("importance").notNull().default(0.5),
    sourceRunId: text("source_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    lastRecalledAt: timestamp("last_recalled_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("memories_workspace_idx").on(t.workspaceId, t.scope)],
).enableRLS();

/**
 * The human-readable task ledger for a workspace. Written when a run
 * terminates; complements (never replaces) the raw event log.
 */
export const taskLog = appSchema.table(
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
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("task_log_workspace_idx").on(t.workspaceId, t.createdAt)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/* Security + evaluations                                                     */
/* -------------------------------------------------------------------------- */

export const securityFindings = appSchema.table(
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
    /** See lib/loop/lifecycle.ts. Only a passing retest may lead to "fixed". */
    status: text("status", { enum: FINDING_STATUSES }).notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("findings_workspace_idx").on(t.workspaceId, t.severity)],
).enableRLS();

/**
 * Immutable snapshots of an agent's behavior-defining fields. Rows are only
 * inserted, never updated: a fix creates a new version instead of editing one.
 */
export const agentVersions = appSchema.table(
  "agent_versions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    version: integer("version").notNull(),
    instructions: text("instructions").notNull(),
    allowedTools: jsonb("allowed_tools").$type<string[]>().notNull(),
    grants: jsonb("grants").$type<PermissionGrant[]>().notNull(),
    inheritedPromptBlockIds: jsonb("inherited_prompt_block_ids")
      .$type<string[]>()
      .notNull(),
    createdBy: text("created_by").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [uniqueIndex("agent_versions_agent_version_idx").on(t.agentId, t.version)],
).enableRLS();

/** One feedback-loop case per accepted finding. See lib/loop/README.md. */
export const findingCases = appSchema.table(
  "finding_cases",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    findingId: text("finding_id").notNull(),
    targetAgentId: text("target_agent_id").notNull(),
    sourceRunId: text("source_run_id").notNull(),
    runGoal: text("run_goal").notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    /** Plain-language account of what the red team saw. */
    observed: text("observed").notNull(),
    proposedRemediation: text("proposed_remediation").notNull().default(""),
    reproduction: jsonb("reproduction").$type<CaseReproduction>().notNull(),
    /** One entry per chain-of-command level the case passed through. */
    hops: jsonb("hops").$type<CaseHop[]>().notNull().default(sql`'[]'`),
    deliveredTo: jsonb("delivered_to").$type<CaseDelivery | null>(),
    conversation: jsonb("conversation")
      .$type<CaseMessage[]>()
      .notNull()
      .default(sql`'[]'`),
    proposal: jsonb("proposal").$type<CaseProposal | null>(),
    approval: jsonb("approval").$type<CaseApproval | null>(),
    /**
     * open (active), queued (behind another case for the same target),
     * escalated (waiting on a person), verified (three clean retests), or
     * closed (merged into another case).
     */
    state: text("state", { enum: ["open", "queued", "escalated", "verified", "closed"] })
      .notNull()
      .default("open"),
    escalationReason: text("escalation_reason"),
    round: integer("round").notNull().default(0),
    maxRounds: integer("max_rounds").notNull().default(3),
    budgetCapUsd: doublePrecision("budget_cap_usd").notNull(),
    spentUsd: doublePrecision("spent_usd").notNull().default(0),
    appliedVersion: integer("applied_version"),
    latestRetestRunId: text("latest_retest_run_id"),
    retests: jsonb("retests").$type<CaseRetest[]>().notNull().default(sql`'[]'`),
    /** The blue-team agents working this case. */
    crew: jsonb("crew").$type<CaseCrew>().notNull().default(sql`'{}'`),
    triage: jsonb("triage").$type<CaseTriage | null>(),
    /** Duplicate findings Triage folded into this case. */
    mergedFindingIds: jsonb("merged_finding_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    uniqueIndex("finding_cases_finding_idx").on(t.findingId),
    index("finding_cases_target_idx").on(t.targetAgentId),
  ],
).enableRLS();

export interface CaseProbe {
  /** Labeled test input sent to the target as the run goal. */
  input: string;
  /** Strings that must never appear in the target's output or tool arguments. */
  canaries: string[];
  kind: "reproduction" | "regression" | "synthetic";
  /** For regression probes: the earlier finding this one re-checks. */
  findingId?: string;
}
export interface CaseReproduction {
  steps: string[];
  probe: CaseProbe;
}
export interface CaseHop {
  agentId: string;
  agentName: string;
  action: "reported" | "forwarded" | "added_context" | "declined_to_act";
  note: string;
  at: string;
}
export interface CaseDelivery {
  creator: string;
  person: string;
  at: string;
}
export interface CaseMessage {
  from: "person" | "creator" | "blue_team" | "platform";
  text: string;
  at: string;
  proposalHash?: string;
}
export type CaseChange =
  | { kind: "instructions"; instructions: string }
  | { kind: "narrow_tools"; removeTools: string[] }
  | { kind: "scoped_rule"; rule: string };
export interface CaseProposal {
  hash: string;
  round: number;
  baseVersion: number;
  change: CaseChange;
  diff: string;
  summary: string;
  /** "live" when a model wrote it, "suggested" when it came from the built-in rules. */
  source: "live" | "suggested";
  /** "agent-creator", or the id of the case's Fix Drafter. Older rows have none. */
  draftedBy?: string;
  at: string;
}
export interface CaseCrew {
  leadId?: string;
  /** One per finding. */
  triageId?: string;
  /** One per case. */
  drafterId?: string;
  /** One per retest round. Never the drafter. */
  verifiers?: Array<{ agentId: string; round: number }>;
  /** Lead runs the platform started for this case, one per step and round. */
  dispatched?: Array<{ phase: "intake" | "draft" | "retest"; round: number; runId: string; at: string }>;
}
export interface CaseTriage {
  by: string;
  /** The platform's check that the reproduction is exact, not the agent's word. */
  reproduces: boolean;
  gaps: string[];
  duplicateOf: string | null;
  note: string;
  at: string;
}
export interface CaseApproval {
  proposalHash: string;
  by: string;
  at: string;
  used: boolean;
}
export interface CaseRetest {
  round: number;
  version: number;
  runs: Array<{ runId: string; kind: CaseProbe["kind"]; canaries: string[]; budgetUsd: number }>;
  /** Probes still to run. Retests run one at a time and stop at the first failure. */
  queued: CaseProbe[];
  runBudgetUsd: number;
  verdict: "pending" | "passed" | "failed";
  failures: Array<{ runId: string; reason: string }>;
  fixture: boolean;
  costUsd: number;
  /** The Verifier of record for this round, and who started it. */
  verifierId?: string;
  requestedBy?: string;
  startedAt: string;
  finishedAt?: string;
}

export const evalSuites = appSchema.table("eval_suites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  cases: jsonb("cases")
    .$type<Array<{ id: string; name: string; input: string; expectedTools: string[] }>>()
    .notNull()
    .default(sql`'[]'`),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}).enableRLS();

export const evalRuns = appSchema.table(
  "eval_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    suiteId: text("suite_id").notNull(),
    /** Optional link to the production run that triggered the eval. */
    runId: text("run_id"),
    status: text("status", { enum: ["running", "passed", "failed"] }).notNull(),
    toolCallAccuracy: doublePrecision("tool_call_accuracy").notNull().default(0),
    taskSuccess: doublePrecision("task_success").notNull().default(0),
    interventionRate: doublePrecision("intervention_rate").notNull().default(0),
    casesPassed: integer("cases_passed").notNull().default(0),
    casesTotal: integer("cases_total").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("eval_runs_suite_idx").on(t.suiteId, t.startedAt)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/* Triggers, budgets, audit                                                   */
/* -------------------------------------------------------------------------- */

export const triggers = appSchema.table("triggers", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  kind: text("kind").$type<Trigger["kind"]>().notNull(),
  cron: text("cron"),
  eventFilter: text("event_filter"),
  enabled: boolean("enabled").notNull().default(true),
  lastFiredAt: timestamp("last_fired_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}).enableRLS();

export const budgetPolicies = appSchema.table("budget_policies", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** null = workspace-wide policy. */
  agentId: text("agent_id"),
  period: text("period").$type<BudgetPolicy["period"]>().notNull(),
  limitUsd: doublePrecision("limit_usd").notNull(),
  warnAt: doublePrecision("warn_at").notNull().default(0.8),
  hardStop: boolean("hard_stop").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}).enableRLS();

/**
 * Configuration changes, credential access and approval decisions land here.
 * Run execution goes to `run_events`; everything that *mutates the platform*
 * goes here. Together they cover the audit surface.
 */
export const auditLog = appSchema.table(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("audit_workspace_idx").on(t.workspaceId, t.at)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type Workspace = typeof workspaces.$inferSelect;
export type User = typeof users.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type PromptBlockRow = typeof promptBlocks.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type Connector = typeof connectors.$inferSelect;
export type ConnectedAccount = typeof connectedAccounts.$inferSelect;
export type ConnectorGrant = typeof connectorGrants.$inferSelect;
export type WorkspaceContextRow = typeof workspaceContexts.$inferSelect;
export type ConnectorCatalogRow = typeof connectorCatalog.$inferSelect;
export type CredentialRow = typeof credentials.$inferSelect;
export type KbDocumentRow = typeof kbDocuments.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type MemoryRow = typeof memories.$inferSelect;
export type TaskLogRow = typeof taskLog.$inferSelect;
export type SecurityFindingRow = typeof securityFindings.$inferSelect;
export type FindingCaseRow = typeof findingCases.$inferSelect;
export type AgentVersionRow = typeof agentVersions.$inferSelect;
export type EvalSuiteRow = typeof evalSuites.$inferSelect;
export type EvalRunRow = typeof evalRuns.$inferSelect;
export type TriggerRow = typeof triggers.$inferSelect;
export type BudgetPolicyRow = typeof budgetPolicies.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
