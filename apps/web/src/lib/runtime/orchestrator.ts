/**
 * Run engine.
 *
 * One run is one append-only event stream. The engine is deliberately a plain
 * loop with no framework: it routes a model, streams a turn, gates every tool
 * call through the policy engine, waits for a human when policy says so, and
 * writes the outcome back as events. Subagents are ordinary recursive calls
 * into the same loop, sharing the run's budget, event log, and approval queue.
 */
import {
  BudgetLedger,
  MODEL_BY_ID,
  TOOL_BY_NAME,
  connectorActionRisk,
  estimateCostUsd,
  evaluatePermission,
  resolveActionEffects,
  hardwareForComplexity,
  isMetaModelId,
  nextAgentRank,
  provisionMetaModel,
  resolvePrompt,
  routeModel,
  type AgentConfig,
  type AgentRank,
  type AgentRole,
  type DataClass,
  type ModelPolicy,
  type PermissionGrant,
  type RunEventPayload,
  type RunStatus,
  type Scope,
  type TaskComplexity,
} from "@agent-os/core";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  agents,
  budgetPolicies,
  promptBlocks,
  runs,
  securityFindings,
  taskLog,
  triggers,
  workspaces,
  type AgentRow,
  type PromptBlockRow,
  type RunRow,
  type Workspace,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import {
  connectedToolkitsFor,
  persistConnectorGrants,
  refreshContextCatalog,
  parseConnectorList,
  SERPAPI_TOOLKIT,
} from "@/lib/connectors";
import { env, newId, serpApiEnabled } from "@/lib/env";
import { recordModelTurn } from "@/lib/observability";
import { redactSecrets } from "@/lib/secrets";
import { createApprovalRequest, waitForApprovalDecision } from "./approvals";
import { RunLogger } from "./emitter";
import { createLiveGateway, liveGatewayAvailable } from "./gateway";
import { ScriptedGateway } from "./gateway-scripted";
import { CASE_TOOL_BY_NAME, executeCaseTool } from "@/lib/loop/case-tools";
import {
  bindCase,
  BLUE_TEAM_SPECIALISTS,
  blueTeamSpecialist,
  caseIdFromGoal,
  DELEGATION_GUIDANCE,
  detectScenario,
  gruntTools,
  redTeamSpecialist,
  RED_TEAM_SPECIALISTS,
  scriptFor,
  SEVERITY_RUBRIC,
  shouldSpawnAdversarialSwarm,
  wantsDeploy,
  type Scenario,
  type TeamSpecialist,
} from "./scripts";
import {
  closedRosterNames,
  delegateAgentName,
  delegateToolDescription,
  heldToolNames,
  isBlueLead,
  isProbeLead,
} from "./capabilities";
import { clampToParent, grantsFromParent } from "./attenuate";
import { insertHelperAgent, reactivateHelper } from "./helper-agents";
import { AgentLifecycle, type AgentOutcome } from "./lifecycle";
import { cancelledRuns, HEARTBEAT_MS, liveRuns } from "./reaper";
import { AgentSandbox } from "./sandbox";
import { fileChildTemplateProposal } from "./template-proposals";
import { executeTool, type ToolContext } from "./tools";
import { parseContextDirectives, WorkspaceContextFile } from "./workspace-context";
import type { ModelGateway, ModelMessage, ToolSpec } from "./types";

const MAX_DELEGATION_DEPTH = 3;

interface AgentResult {
  status: "succeeded" | "failed" | "halted";
  summary: string;
}

interface RunnerOptions {
  workspaceId: string;
  agentId: string;
  goal: string;
  trigger?: "manual" | "schedule" | "webhook" | "api";
  dataClass?: DataClass;
  budgetUsd?: number;
  mode?: "scripted" | "live";
  triggerId?: string | null;
  /** "retest" for feedback-loop retests (lib/loop). */
  purpose?: "standard" | "retest";
  /** Composio user id for connected apps (Supabase auth id or local:…). */
  operatorUserId?: string | null;
}

const DATA_CLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

function stricterDataClass(a: DataClass, b: DataClass): DataClass {
  return DATA_CLASS_RANK[a] >= DATA_CLASS_RANK[b] ? a : b;
}

function asAgentConfig(row: AgentRow): AgentConfig {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function argsString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Creating a run                                                             */
/* -------------------------------------------------------------------------- */

export async function createRun(options: RunnerOptions): Promise<string> {
  const db = getDb();

  const [agent] = await db.select().from(agents).where(eq(agents.id, options.agentId)).limit(1);
  if (!agent) throw new Error(`Agent ${options.agentId} does not exist.`);
  if (agent.workspaceId !== options.workspaceId) {
    throw new Error("Agent belongs to a different workspace.");
  }
  if (agent.status !== "active") {
    throw new Error(
      `${agent.name} is ${agent.status}; publish it before dispatching a run.`,
    );
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, options.workspaceId))
    .limit(1);
  if (!workspace) throw new Error("Workspace does not exist.");

  const policies = await db
    .select()
    .from(budgetPolicies)
    .where(eq(budgetPolicies.workspaceId, options.workspaceId));
  const runPolicy = policies.find((p) => p.agentId === agent.id && p.period === "run");
  const dayPolicy = policies.find((p) => p.agentId === null && p.period === "day");

  const requested = options.budgetUsd ?? runPolicy?.limitUsd ?? workspace.defaultRunBudgetUsd;
  const budgetUsd = runPolicy ? Math.min(requested, runPolicy.limitUsd) : requested;

  if (dayPolicy) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = await db
      .select({ cost: runs.costUsd })
      .from(runs)
      .where(and(eq(runs.workspaceId, options.workspaceId), gte(runs.startedAt, startOfDay)));
    const spentToday = today.reduce((sum, row) => sum + row.cost, 0);
    if (spentToday + budgetUsd > dayPolicy.limitUsd) {
      throw new Error(
        `Workspace daily budget exhausted: $${spentToday.toFixed(2)} spent of $${dayPolicy.limitUsd.toFixed(2)}.`,
      );
    }
  }

  const mode =
    options.mode === "live" && liveGatewayAvailable() ? "live" : "scripted";

  const runId = newId("run");
  const now = new Date();
  await db.insert(runs).values({
    id: runId,
    workspaceId: options.workspaceId,
    agentId: agent.id,
    triggerId: options.triggerId ?? null,
    goal: options.goal,
    status: "queued",
    dataClass: stricterDataClass(options.dataClass ?? workspace.defaultDataClass, agent.dataClass),
    budgetUsd,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    mode,
    purpose: options.purpose ?? "standard",
    operatorUserId: options.operatorUserId ?? null,
    startedAt: now,
    heartbeatAt: now,
    eventCount: 0,
  });

  // Deliberately not awaited: the HTTP handler returns the run id immediately
  // and the client follows the event stream. The promise is kept alive by this
  // process, which is the same process that serves the stream.
  void executeRun(runId).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[run ${runId}] engine crashed`, error);
  });

  return runId;
}

export async function cancelRun(runId: string): Promise<void> {
  const db = getDb();
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error("That run does not exist.");
  if (run.status === "succeeded" || run.status === "failed" || run.status === "halted" || run.status === "cancelled") {
    return;
  }
  cancelledRuns().add(runId);
  await db
    .update(runs)
    .set({ status: "cancelled", failureReason: "Stopped by the operator." })
    .where(eq(runs.id, runId));
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                     */
/* -------------------------------------------------------------------------- */

export async function executeRun(runId: string): Promise<void> {
  const db = getDb();
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error(`Run ${runId} does not exist.`);

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, run.workspaceId))
    .limit(1);
  if (!workspace) throw new Error("Workspace disappeared.");

  const [agentRows, blocks] = await Promise.all([
    db.select().from(agents).where(eq(agents.workspaceId, run.workspaceId)),
    db.select().from(promptBlocks).where(eq(promptBlocks.workspaceId, run.workspaceId)),
  ]);

  const logger = await RunLogger.open(runId);
  const engine = new RunEngine(run, workspace, agentRows, blocks, logger);

  // The heartbeat tells the reaper this process is still running the run.
  liveRuns().add(runId);
  const beat = () =>
    db.update(runs).set({ heartbeatAt: new Date() }).where(eq(runs.id, runId)).catch(() => undefined);
  await beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_MS);
  timer.unref?.();
  try {
    await engine.execute();
  } finally {
    clearInterval(timer);
    liveRuns().delete(runId);
    cancelledRuns().delete(runId);
  }
}

class RunEngine {
  readonly #ledger: BudgetLedger;
  readonly #runKey: string;
  readonly #scenario: Scenario;
  readonly #spawned = new Set<string>();
  /** Who has work left in this run. See lifecycle.ts. */
  readonly #lifecycle = new AgentLifecycle();
  /** Helpers created during this run; they retire once their work is done. */
  readonly #spawnedGrunts = new Set<string>();
  readonly #grantedHighRisk = new Set<string>();
  readonly #runConnectors = new Map<string, string[]>();
  #orchestratorConnectors: string[] = [];
  readonly #budgetWrapUp = new Set<string>();
  readonly #downgraded = new Set<string>();
  readonly #live: boolean;
  readonly #liveGateway: ModelGateway | null;
  #inputTokens = 0;
  #outputTokens = 0;
  #status: RunStatus = "running";

  constructor(
    private readonly run: RunRow,
    private readonly workspace: Workspace,
    private readonly agentRows: AgentRow[],
    private readonly blocks: PromptBlockRow[],
    private readonly logger: RunLogger,
  ) {
    this.#runKey = `run:${run.id}`;
    this.#ledger = new BudgetLedger([
      { key: this.#runKey, limitUsd: run.budgetUsd, warnAt: 0.8, hardStop: env.defaults.hardStopBudgets },
    ]);
    this.#scenario = detectScenario(run.goal);
    this.#live = run.mode === "live" && liveGatewayAvailable();
    this.#liveGateway = this.#live ? createLiveGateway() : null;
  }

  private get costUsd(): number {
    return Number(this.#ledger.spentUsd.toFixed(6));
  }

  async execute(): Promise<void> {
    const started = Date.now();
    const root = this.agentRows.find((a) => a.id === this.run.agentId);
    if (!root) throw new Error("Root agent no longer exists.");

    let trigger: "manual" | "schedule" | "webhook" | "api" = "manual";
    if (this.run.triggerId) {
      const [row] = await getDb()
        .select()
        .from(triggers)
        .where(eq(triggers.id, this.run.triggerId))
        .limit(1);
      if (row) trigger = row.kind;
    }

    try {
      await this.logger.emit(
        {
          type: "run.started",
          goal: this.run.goal,
          orchestratorAgentId: root.id,
          trigger,
          budgetUsd: this.run.budgetUsd,
          dataClass: this.run.dataClass,
        },
        root.id,
      );

      await this.#setStatus("running");
      await this.logger.emit(
        {
          type: "log",
          level: "info",
          message: this.#live
            ? "run started against a live model gateway"
            : "run started with the scripted planner; every tool call still executes for real",
          agentId: root.id,
          fields: { mode: this.run.mode, budgetUsd: this.run.budgetUsd, scenario: this.#scenario },
        },
        root.id,
      );

      await this.#applyContextDirectives(root.id);
      await this.#loadConnectors(root);

      const result = await this.#runAgent(root, null, 0, null);
      if (result.status === "succeeded") {
        await this.#maybeSpawnAdversarialSwarm(root);
      }

      const summary = redactSecrets(result.summary || "Run completed with no final message.");
      const status: RunStatus = this.#isCancelled()
        ? "cancelled"
        : this.#status === "halted" || result.status === "halted"
          ? "halted"
          : result.status;
      const reason =
        status === "cancelled"
          ? "Stopped by the operator."
          : status === "halted"
            ? `Halted by the run budget ceiling ($${this.run.budgetUsd.toFixed(2)}).`
            : null;

      await this.#endAll(status === "succeeded" ? "done" : "failed");
      await this.logger.emit(
        {
          type: "run.completed",
          status,
          summary,
          reason: reason ?? undefined,
          totalCostUsd: this.costUsd,
          durationMs: Math.max(1, Date.now() - started),
        },
        root.id,
      );
      await this.#finish(status, summary, reason);
    } catch (error) {
      const message = (error as Error).message;
      const reason = redactSecrets(message).slice(0, 900);
      await this.logger.emit({ type: "log", level: "error", message: reason }, this.run.agentId);
      await this.#endAll("failed").catch(() => undefined);
      await this.logger.emit({
        type: "run.completed",
        status: "failed",
        summary: "Run failed before it could complete.",
        reason,
        totalCostUsd: this.costUsd,
        durationMs: Math.max(1, Date.now() - started),
      });
      await this.#finish("failed", "Run failed before it could complete.", reason);
    }
  }

  /* ------------------------------------------------------------------ agent */

  /**
   * Run one agent. Whatever happens inside, its lifetime ends here: once it
   * and everything it delegated to have no work left, it terminates.
   */
  async #runAgent(
    agent: AgentRow,
    taskId: string | null,
    depth: number,
    parentTask: string | null,
    delegatorId: string | null = null,
  ): Promise<AgentResult> {
    this.#lifecycle.start(agent.id, delegatorId);
    let outcome: AgentOutcome = "failed";
    try {
      const result = await this.#runAgentSteps(agent, taskId, depth, parentTask);
      outcome = result.status === "succeeded" ? "done" : "failed";
      return result;
    } finally {
      await this.#terminate(this.#lifecycle.finish(agent.id, outcome));
    }
  }

  /** Report terminated agents and retire helpers this run created. */
  async #terminate(ended: string[]): Promise<void> {
    for (const id of ended) {
      const row = this.agentRows.find((a) => a.id === id);
      if (!row || !this.#spawned.has(id)) continue;
      const done = this.#lifecycle.outcome(id) === "done";
      await this.logger.emit({ type: "agent.status", agentId: id, status: done ? "done" : "failed" }, id);
      if (this.#spawnedGrunts.has(id) && row.status !== "archived") {
        await getDb().update(agents).set({ status: "archived", updatedAt: new Date() }).where(eq(agents.id, id));
        row.status = "archived";
        await this.logger.emit(
          { type: "log", level: "info", message: `${row.name} has no work left and stopped. It will come back if it is needed again.`, agentId: id },
          id,
        );
      }
    }
  }

  /** At run end, nothing is left working: terminate whatever is still open. */
  async #endAll(outcome: AgentOutcome): Promise<void> {
    await this.#terminate(this.#lifecycle.terminateAll(outcome));
  }

  async #runAgentSteps(
    agent: AgentRow,
    taskId: string | null,
    depth: number,
    parentTask: string | null,
  ): Promise<AgentResult> {
    if (depth > MAX_DELEGATION_DEPTH) {
      return { status: "failed", summary: "Delegation depth limit reached." };
    }
    if (this.#isCancelled()) {
      return { status: "failed", summary: "Stopped by the operator." };
    }
    if (this.#isHalted()) {
      return { status: "halted", summary: "Budget ceiling reached." };
    }

    const dataClass = stricterDataClass(this.run.dataClass, agent.dataClass);
    const config = asAgentConfig(agent);
    const prompt = resolvePrompt(config, this.blocks);

    const route = routeModel({
      complexity: agent.complexity,
      dataClass,
      requiredCapabilities: ["tool_calling"],
      estimatedInputTokens: Math.max(3_000, Math.ceil(prompt.text.length / 4) + 2_000),
      estimatedOutputTokens: 900,
      costSensitivity: agent.modelPolicy.costSensitivity,
      latencySensitivity: agent.modelPolicy.latencySensitivity,
      pinnedModelId:
        agent.modelPolicy.mode === "pinned"
          ? (agent.modelPolicy.pinnedModelId ?? undefined)
          : undefined,
      deniedModelIds: [
        ...this.workspace.deniedModelIds,
        ...agent.modelPolicy.deniedModelIds,
      ],
    });

    const model = route.chosenModel;

    if (!this.#spawned.has(agent.id)) {
      this.#spawned.add(agent.id);
      await this.logger.emit(
        {
          type: "agent.spawned",
          agentId: agent.id,
          parentAgentId: agent.parentAgentId,
          name: agent.name,
          role: agent.role as AgentRole,
          model,
        },
        agent.id,
      );
    }

    await this.logger.emit(
      {
        type: "router.decision",
        agentId: agent.id,
        taskId,
        chosenModel: model,
        hwTier: hardwareForComplexity(agent.complexity).tier,
        reason: route.reason,
        estimatedCostUsd: Number(route.estimatedCostUsd.toFixed(6)),
        candidates: route.candidates,
      },
      agent.id,
    );

    const sandbox = new AgentSandbox(env.sandboxRoot, this.run.workspaceId, agent.id);
    sandbox.provision({
      agentName: agent.name,
      role: agent.role,
      summary: agent.summary || agent.instructions.slice(0, 200),
    });

    const gateway: ModelGateway =
      this.#liveGateway ??
      new ScriptedGateway(
        bindCase(
          scriptFor(this.#scenario, agent.name, agent.role as AgentRole, this.run.goal),
          caseIdFromGoal(this.run.goal),
        ),
        { chunkDelayMs: 0 },
      );

    const contextFile = new WorkspaceContextFile(env.sandboxRoot, this.run.workspaceId);
    contextFile.ensure();
    const held = heldToolNames(agent, this.#connectorsFor(agent), this.run.dataClass);

    const messages: ModelMessage[] = [
      {
        role: "system",
        content: `${prompt.text}${specialistRoster(agent)}${delegationGuidance(agent)}${contextFile.promptBlock({ canWrite: held.has("context.write") })}`,
      },
      {
        role: "user",
        content:
          depth === 0
            ? this.run.goal
            : parentTask ??
              "Complete the delegated task and return a short, factual summary.",
      },
    ];

    const tools = this.#toolSpecs(agent);
    let lastText = "";

    const baseModel =
      MODEL_BY_ID.get(model) ?? {
        id: model,
        label: model,
        provider: "unknown",
        tier: "balanced" as const,
        contextWindow: 200_000,
        inputPerMTok: 3,
        outputPerMTok: 15,
        allowedDataClasses: ["public", "internal"] as const,
        capabilities: ["tool_calling"] as const,
        latencyMs: 500,
        selfHosted: false,
      };
    const baseProjected = estimateCostUsd(baseModel, 3_000, 900);

    await this.logger.emit(
      { type: "agent.status", agentId: agent.id, status: "thinking" },
      agent.id,
    );

    for (let step = 0; step < agent.maxSteps; step++) {
      if (this.#isCancelled()) {
        this.#status = "cancelled";
        return { status: "failed", summary: "Stopped by the operator." };
      }
      if (this.#isHalted()) {
        return { status: "halted", summary: "Budget ceiling reached mid-task." };
      }

      // Budget-aware routing is a mid-run decision, not just a pre-flight one.
      // At 75% of the run ceiling the router tries a cheaper viable model for
      // the next step and injects a wrap-up directive, so the run lands under
      // budget instead of slamming into the hard stop.
      const utilization =
        this.#ledger.spentFor(this.#runKey) / Math.max(this.run.budgetUsd, 1e-9);
      let stepModel = model;
      let projected = baseProjected;
      if (utilization >= 0.75) {
        const cheaper = route.candidates
          .filter(
            (candidate) =>
              !candidate.rejectedReason &&
              candidate.model !== model &&
              candidate.estimatedCostUsd < baseProjected,
          )
          .sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd)[0];

        if (cheaper) {
          stepModel = cheaper.model;
          projected = cheaper.estimatedCostUsd;
          if (!this.#downgraded.has(agent.id)) {
            this.#downgraded.add(agent.id);
            await this.logger.emit(
              {
                type: "router.decision",
                agentId: agent.id,
                taskId,
                chosenModel: stepModel,
                hwTier: hardwareForComplexity(agent.complexity).tier,
                reason: `Budget guardrail at ${Math.round(utilization * 100)}% of the run ceiling; downgraded ${model} → ${stepModel}.`,
                estimatedCostUsd: cheaper.estimatedCostUsd,
                candidates: route.candidates,
              },
              agent.id,
            );
          }
        }

        if (!this.#budgetWrapUp.has(agent.id)) {
          this.#budgetWrapUp.add(agent.id);
          messages.push({
            role: "system",
            content:
              `Budget guardrail: ${Math.round(utilization * 100)}% of this run's ceiling is spent. ` +
              "Finish with what is already known, avoid optional tool calls, and return a concise answer under budget.",
          });
          await this.logger.emit(
            {
              type: "log",
              level: "warn",
              message: `budget at ${Math.round(utilization * 100)}%; router switched to wrap-up mode`,
              agentId: agent.id,
              fields: { spentUsd: this.costUsd, ceilingUsd: this.run.budgetUsd },
            },
            agent.id,
          );
        }
      }

      const budget = this.#ledger.canSpend(projected, [this.#runKey]);
      if (budget.kind === "halt") {
        this.#status = "halted";
        await this.logger.emit({
          type: "budget.halted",
          scope: "run",
          spentUsd: Number(budget.spentUsd.toFixed(6)),
          limitUsd: budget.limitUsd,
        });
        await this.#setStatus("halted", budget.reason);
        return { status: "halted", summary: "Halted by the run budget ceiling." };
      }
      if (budget.kind === "warn") {
        await this.logger.emit({
          type: "budget.warning",
          scope: "run",
          spentUsd: Number(budget.spentUsd.toFixed(6)),
          limitUsd: budget.limitUsd,
          threshold: budget.threshold,
        });
      }

      await this.logger.emit(
        { type: "agent.status", agentId: agent.id, status: "thinking" },
        agent.id,
      );

      let text = "";
      let thinking = "";
      let usage: { inputTokens: number; outputTokens: number } | null = null;
      const calls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

      for await (const chunk of gateway.complete({
        model: stepModel,
        messages,
        tools,
        temperature: 0.2,
        maxOutputTokens: 1_600,
        // Muse models return empty completions on chat completions without an
        // explicit reasoning effort; other providers ignore the field.
        reasoningEffort:
          MODEL_BY_ID.get(stepModel)?.provider === "meta" ? "medium" : undefined,
      })) {
        if (chunk.type === "text") text += chunk.text;
        if (chunk.type === "thinking") thinking += chunk.text;
        if (chunk.type === "usage") usage = chunk;
        if (chunk.type === "tool_call") calls.push(chunk.call);
      }

      if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
        const cost = this.#ledger.record({
          model: MODEL_BY_ID.get(stepModel) ?? {
            id: stepModel,
            inputPerMTok: 3,
            outputPerMTok: 15,
          },
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          keys: [this.#runKey],
        }).costUsd;

        this.#inputTokens += usage.inputTokens;
        this.#outputTokens += usage.outputTokens;

        await this.logger.emit(
          {
            type: "model.usage",
            agentId: agent.id,
            model: stepModel,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: Number(cost.toFixed(6)),
          },
          agent.id,
        );
        if (this.#live) {
          await recordModelTurn({
            workspaceId: this.run.workspaceId,
            source: "run",
            runId: this.run.id,
            agentId: agent.id,
            agentName: agent.name,
            model: stepModel,
            step,
            messages,
            completion: text,
            thinking,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: Number(cost.toFixed(6)),
            dataClass: this.run.dataClass,
          });
        }
        await this.#persistProgress();
      } else if (this.#live) {
        // The provider streamed no usage for a live call. Say so loudly:
        // without usage the budget ledger stays blind for this step.
        await this.logger.emit(
          {
            type: "log",
            level: "warn",
            message: `live gateway returned no usage for model ${stepModel}; cost not recorded`,
            agentId: agent.id,
          },
          agent.id,
        );
      }

      if (thinking.trim()) {
        await this.logger.emit(
          {
            type: "log",
            level: "info",
            message: redactSecrets(thinking.trim()),
            agentId: agent.id,
            fields: { channel: "thinking" },
          },
          agent.id,
        );
      }

      if (text.trim()) {
        lastText = text.trim();
        await this.logger.emit(
          {
            type: "agent.message",
            agentId: agent.id,
            role: "assistant",
            text: redactSecrets(text.trim()),
          },
          agent.id,
        );
      }

      if (calls.length === 0) {
        if (text.trim()) messages.push({ role: "assistant", content: text.trim() });
        break;
      }

      // One assistant turn can request several tools. Both provider adapters
      // need the whole set on a single assistant message.
      messages.push({
        role: "assistant",
        content: text.trim(),
        toolCalls: calls.map((call) => ({
          id: call.id,
          name: call.name,
          args: call.args,
        })),
      });

      for (const call of calls) {
        const result = await this.#handleToolCall(agent, sandbox, taskId, call, depth);

        messages.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: result.ok ? result.preview : `ERROR: ${result.error ?? "tool failed"}`,
        });
      }
    }

    return { status: "succeeded", summary: lastText || `${agent.name} finished.` };
  }

  #toolSpecs(agent: AgentRow): ToolSpec[] {
    const names = heldToolNames(agent, this.#connectorsFor(agent), this.run.dataClass);

    return [...names]
      .map((name) => TOOL_BY_NAME.get(name) ?? CASE_TOOL_BY_NAME.get(name))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => ({
        name: entry.name,
        description:
          entry.name === "agent.delegate" ? delegateToolDescription(agent) : entry.description,
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            command: { type: "string" },
            url: { type: "string" },
            query: { type: "string" },
            credential: { type: "string" },
            agent: { type: "string" },
            title: { type: "string" },
            task: { type: "string" },
            model: { type: "string" },
            complexity: { type: "string" },
            include: { type: "string" },
            remove: { type: "string" },
            summary: { type: "string" },
            scope: { type: "string" },
            kind: { type: "string" },
            severity: { type: "string" },
            category: { type: "string" },
            detail: { type: "string" },
            evidence: { type: "string" },
            remediation: { type: "string" },
            case: { type: "string" },
            note: { type: "string" },
            instructions: { type: "string" },
            rule: { type: "string" },
            reply: { type: "string" },
            removeTools: { type: "array", items: { type: "string" } },
            toolkit: { type: "string" },
            action: { type: "string" },
            arguments: { type: "object" },
            connectors: { type: "array", items: { type: "string" } },
            engine: { type: "string" },
            num: { type: "number" },
          },
          additionalProperties: true,
          ...(entry.name === "agent.delegate" ? { required: ["agent", "task"] } : {}),
        },
      }));
  }

  /* ------------------------------------------------------------------- tool */

  async #handleToolCall(
    agent: AgentRow,
    sandbox: AgentSandbox,
    taskId: string | null,
    call: { id: string; name: string; args: Record<string, unknown> },
    depth: number,
  ): Promise<{ ok: boolean; preview: string; error?: string }> {
    const started = Date.now();
    const manifest = TOOL_BY_NAME.get(call.name) ?? CASE_TOOL_BY_NAME.get(call.name);
    const emitAsAgent = async (payload: RunEventPayload): Promise<void> => {
      await this.logger.emit(payload, agent.id);
    };

    const actionName = argsString(call.args, "action") ?? argsString(call.args, "tool") ?? "";
    const risk =
      call.name === "connector.call" ? connectorActionRisk(actionName) : (manifest?.risk ?? "high");
    const scopes = (manifest?.scopes ?? ["read"]) as Scope[];

    await this.logger.emit(
      {
        type: "tool.requested",
        callId: call.id,
        agentId: agent.id,
        taskId,
        tool: call.name,
        args: this.#redactArgs(call.args),
        risk,
        scopes,
      },
      agent.id,
    );

    if (!manifest) {
      return this.#toolFailure(
        agent,
        call.id,
        call.name,
        0,
        `Unknown tool "${call.name}".`,
      );
    }

    // Case tools belong to the blue team; security.report to the red team.
    // Neither can be granted by an agent. The set here is the same one the
    // model saw in its tool list, so a denial cannot follow an advertisement.
    const held = heldToolNames(agent, this.#connectorsFor(agent), this.run.dataClass);
    if (!held.has(call.name)) {
      return this.#toolFailure(
        agent,
        call.id,
        call.name,
        0,
        `${agent.name} does not hold the "${call.name}" capability.`,
      );
    }

    // A security agent may never hold a production credential. The denial is
    // structural, not a model failure: it is recorded and the agent continues.
    if (call.name === "secret.use" && agent.role === "security") {
      return this.#toolFailure(
        agent,
        call.id,
        call.name,
        Date.now() - started,
        "Security agents never receive production credentials. Request denied by org policy; use the fixture.",
      );
    }

    // Retest runs carry synthetic test data with canary secrets only. They may
    // not reach real credentials or write into memory other runs read.
    if (this.run.purpose === "retest" && (call.name === "secret.use" || call.name === "memory.write")) {
      return this.#toolFailure(
        agent,
        call.id,
        call.name,
        Date.now() - started,
        `Retest runs use synthetic test data, so ${call.name} is off for this run.`,
      );
    }

    const path = argsString(call.args, "path") ?? undefined;
    const host = argsString(call.args, "url")
      ? (() => {
          try {
            return new URL(argsString(call.args, "url") as string).hostname;
          } catch {
            return undefined;
          }
        })()
      : undefined;

    const decision = evaluatePermission(
      {
        resource: call.name,
        scopes,
        risk,
        agentGrants: agent.grants,
        path,
        host,
      },
      undefined,
      resolveActionEffects(this.workspace.actionEffects),
    );

    if (decision.effect === "deny") {
      return this.#toolFailure(
        agent,
        call.id,
        call.name,
        Date.now() - started,
        `Denied by policy (${decision.matchedRuleId ?? "default"}): ${decision.reason}`,
      );
    }

    if (decision.effect === "require_approval") {
      const grantKey = `${agent.id}:${call.name}`;
      const covered = (risk === "high" || risk === "critical") && this.#grantedHighRisk.has(grantKey);

      if (!covered) {
        const approvalId = newId("apr");
        const reason =
          risk === "high" || risk === "critical"
            ? `${decision.reason} Risk is ${risk}, so this is a per-run human decision.`
            : decision.reason;

        await createApprovalRequest({
          id: approvalId,
          workspaceId: this.run.workspaceId,
          runId: this.run.id,
          agentId: agent.id,
          callId: call.id,
          resource: call.name,
          scopes: manifest.scopes,
          risk,
          reason,
        });

        await this.logger.emit(
          {
            type: "permission.requested",
            approvalId,
            agentId: agent.id,
            callId: call.id,
            resource: call.name,
            scopes: manifest.scopes,
            risk,
            reason,
          },
          agent.id,
        );
        await this.#setStatus("awaiting_approval");
        await this.logger.emit(
          {
            type: "log",
            level: "warn",
            message: `${agent.name} is waiting for approval to use ${call.name}.`,
            agentId: agent.id,
            fields: { approvalId, callId: call.id },
          },
          agent.id,
        );

        const resolution = await waitForApprovalDecision(approvalId);

        await this.logger.emit(
          {
            type: "permission.resolved",
            approvalId,
            decision: resolution.decision,
            decidedBy: resolution.decidedBy,
            note: resolution.note ?? undefined,
          },
          agent.id,
        );

        await writeAudit({
          workspaceId: this.run.workspaceId,
          actor: resolution.decidedBy,
          action: `approval.${resolution.decision}`,
          targetType: "approval",
          targetId: approvalId,
          detail: {
            runId: this.run.id,
            agentId: agent.id,
            resource: call.name,
            note: resolution.note,
          },
        });

        await this.#setStatus("running");

        if (resolution.decision !== "approved") {
          return this.#toolFailure(
            agent,
            call.id,
            call.name,
            Date.now() - started,
            `Denied by approval ${approvalId} (${resolution.decidedBy}). Do not retry in this run.`,
          );
        }

        if (risk === "high") this.#grantedHighRisk.add(grantKey);

        await this.logger.emit(
          {
            type: "log",
            level: "info",
            message: `${call.name} approved by ${resolution.decidedBy} for this run.`,
            agentId: agent.id,
          },
          agent.id,
        );
      }
    }

    if (decision.effect === "allow_with_log") {
      await emitAsAgent({
        type: "log",
        level: "info",
        message: `policy allowed ${call.name} with logging (${decision.matchedRuleId ?? "grant"}).`,
        agentId: agent.id,
      });
    }

    let result: { ok: boolean; preview: string; error?: string };

    if (call.name === "agent.delegate") {
      result = await this.#delegate(agent, taskId, call, depth, started);
    } else if (call.name === "security.report") {
      result = await this.#reportFinding(agent, call);
    } else if (CASE_TOOL_BY_NAME.has(call.name)) {
      result = await executeCaseTool(agent, call.name, call.args, caseIdFromGoal(this.run.goal));
    } else {
      const ctx: ToolContext = {
        workspaceId: this.run.workspaceId,
        runId: this.run.id,
        agentId: agent.id,
        agentName: agent.name,
        sandbox,
        dataClass: this.run.dataClass,
        operatorUserId: this.run.operatorUserId ?? undefined,
        allowedConnectors: this.#connectorsFor(agent),
        emit: emitAsAgent,
      };
      try {
        result = await executeTool(ctx, call.name, call.args);
      } catch (error) {
        result = {
          ok: false,
          preview: "",
          error: redactSecrets((error as Error).message),
        };
      }
    }

    await this.logger.emit(
      {
        type: "tool.completed",
        callId: call.id,
        agentId: agent.id,
        tool: call.name,
        ok: result.ok,
        durationMs: Math.max(1, Date.now() - started),
        resultPreview: result.preview ? redactSecrets(result.preview).slice(0, 600) : undefined,
        error: result.error,
      },
      agent.id,
    );

    return result;
  }

  async #delegate(
    agent: AgentRow,
    taskId: string | null,
    call: { id: string; name: string; args: Record<string, unknown> },
    depth: number,
    started: number,
  ): Promise<{ ok: boolean; preview: string; error?: string }> {
    const requested = delegateAgentName(call.args);
    const title = argsString(call.args, "title") ?? "Delegated task";
    const task = argsString(call.args, "task") ?? "Complete the delegated task.";

    if (!requested) {
      const roster = closedRosterNames(agent);
      const hint = roster ? ` Use one of: ${roster}.` : "";
      return { ok: false, preview: "", error: `agent.delegate requires an agent name.${hint}` };
    }
    if (agent.rank === "grunt") {
      return { ok: false, preview: "", error: "Grunts cannot create or delegate to subagents." };
    }

    const normalised = requested.toLowerCase();
    const nameMatch = (row: AgentRow) =>
      row.name.toLowerCase() === normalised || row.id === requested || row.slug === normalised;

    let child = this.agentRows.find((row) => row.parentAgentId === agent.id && nameMatch(row));

    if (isBlueLead(agent)) {
      const assigned = await this.#delegateCaseWork(agent, requested, call.args);
      if ("error" in assigned) return { ok: false, preview: "", error: assigned.error };
      child = assigned.child;
    }

    if (!child && isProbeLead(agent)) {
      if (!agent.canSpawnSubagents) {
        return {
          ok: false,
          preview: "",
          error: `${agent.name} does not have dynamic subagent creation turned on.`,
        };
      }
      const spec = redTeamSpecialist(requested);
      if (!spec) {
        const names = RED_TEAM_SPECIALISTS.map((item) => item.name).join(", ");
        return {
          ok: false,
          preview: "",
          error: `${agent.name} can only stand up a probe specialist: ${names}.`,
        };
      }
      child = await this.#spawnSpecialist(agent, spec);
    }

    // Grunts returned above, so every agent here may delegate.
    if (!child) {
      if (agent.sourceAgentId && !agent.canSpawnSubagents) {
        return { ok: false, preview: "", error: `${agent.name} can only delegate to agents connected below it in this workflow.` };
      }
      const existing = this.agentRows.find(nameMatch);
      if (existing) {
        child = existing;
      } else if (!agent.canSpawnSubagents) {
        return {
          ok: false,
          preview: "",
          error: `${agent.name} does not have dynamic subagent creation turned on.`,
        };
      } else {
        child = await this.#spawnGrunt(agent, requested, task, call.args.tools, call.args.connectors);
      }
    }

    if (child.id === agent.id) {
      return { ok: false, preview: "", error: "An agent cannot delegate to itself." };
    }
    // Without a connectors argument, a child keeps the apps it was built with, still within the parent's.
    const requestedApps =
      call.args.connectors === undefined ? child.allowedConnectors : parseConnectorList(call.args.connectors);
    const granted = requestedApps.filter((slug) => this.#connectorsFor(agent).includes(slug));
    this.#runConnectors.set(child.id, granted);
    child.allowedConnectors = granted;
    await persistConnectorGrants(this.run.workspaceId, child.id, granted, agent.id);
    if (child.status === "archived" && child.parentAgentId === agent.id) {
      // A helper that stopped earlier comes back for new work.
      const revived = await reactivateHelper(child);
      Object.assign(child, revived);
    }

    const requestedModel = argsString(call.args, "model");
    const complexity = complexityForTask(task, argsString(call.args, "complexity"));
    const pinned =
      requestedModel && isMetaModelId(requestedModel)
        ? requestedModel
        : provisionMetaModel(complexity, this.workspace.deniedModelIds);
    child.modelPolicy = {
      ...child.modelPolicy,
      mode: "pinned",
      pinnedModelId: pinned,
      floorComplexity: complexity === "trivial" ? "standard" : complexity,
    };
    child.complexity = complexity;

    const childTaskId = newId("tsk");
    await this.logger.emit(
      {
        type: "task.created",
        taskId: childTaskId,
        agentId: child.id,
        parentTaskId: taskId,
        title,
        detail: task,
      },
      child.id,
    );
    await this.logger.emit(
      {
        type: "task.updated",
        taskId: childTaskId,
        status: "running",
      },
      child.id,
    );
    await this.logger.emit(
      {
        type: "handoff",
        fromAgentId: agent.id,
        toAgentId: child.id,
        summary: `${agent.name} → ${child.name}: ${title}`,
      },
      child.id,
    );

    const result = await this.#runAgent(child, childTaskId, depth + 1, task, agent.id);

    await this.logger.emit(
      {
        type: "task.updated",
        taskId: childTaskId,
        status: result.status === "succeeded" ? "succeeded" : "failed",
        note: redactSecrets(result.summary).slice(0, 400),
      },
      child.id,
    );
    await this.logger.emit(
      {
        type: "handoff",
        fromAgentId: child.id,
        toAgentId: agent.id,
        summary: redactSecrets(result.summary).slice(0, 600),
      },
      agent.id,
    );

    return {
      ok: result.status === "succeeded",
      preview: `Report from ${child.name} to ${agent.name} (${childTaskId}) ${result.status} in ${Date.now() - started}ms\n${redactSecrets(result.summary).slice(0, 900)}`,
      ...(result.status === "succeeded" ? {} : { error: `${child.name} did not complete.` }),
    };
  }

  /**
   * The Blue Team Lead hands one step of one case to a grunt made for it: a
   * Triage per finding, a Fix Drafter per case, a Verifier per round. The
   * roster comes from scripts.ts; the separation rules from lib/loop/blue-team.ts.
   */
  async #delegateCaseWork(
    lead: AgentRow,
    requested: string,
    args: Record<string, unknown>,
  ): Promise<{ child: AgentRow } | { error: string }> {
    const spec = blueTeamSpecialist(requested);
    if (!spec) {
      const names = BLUE_TEAM_SPECIALISTS.map((item) => item.name).join(", ");
      return { error: `${lead.name} hands case work only to its roster: ${names}.` };
    }
    if (!lead.canSpawnSubagents) {
      return { error: `${lead.name} does not have dynamic subagent creation turned on.` };
    }
    const caseId = argsString(args, "case") ?? caseIdFromGoal(this.run.goal);
    if (!caseId) return { error: `Name the case ${spec.name} should work on.` };
    const blue = await import("@/lib/loop/blue-team");
    try {
      const name = await blue.crewMemberName(caseId, spec.crewRole, spec.name);
      const child =
        this.agentRows.find((row) => row.parentAgentId === lead.id && row.name === name) ??
        (await this.#spawnSpecialist(lead, spec, name));
      await blue.assignCrew(caseId, spec.crewRole, child.id, lead.id);
      return { child };
    } catch (error) {
      return { error: redactSecrets((error as Error).message) };
    }
  }

  /**
   * Insert a team specialist under its lead. Specialists are grunts. Red ones
   * are kept for later runs; blue ones are made per case and retire with it.
   */
  async #spawnSpecialist(parent: AgentRow, spec: TeamSpecialist, name = spec.name): Promise<AgentRow> {
    const now = new Date();
    const id = newId("agt");
    const slugBase =
      name === spec.name
        ? spec.slug
        : name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "")
            .slice(0, 48);
    const slugTaken = this.agentRows.some(
      (row) => row.workspaceId === parent.workspaceId && row.slug === slugBase,
    );
    const slug = slugTaken ? `${slugBase}-${id.slice(4, 8)}` : slugBase;
    const tools = specialistTools(spec.tools);
    const grants = grantsForSpecialist(tools);
    const role = spec.team === "red" ? "security" : "worker";

    const { row: created, created: isNew } = await insertHelperAgent({
        id,
        workspaceId: parent.workspaceId,
        name,
        slug,
        role,
        rank: "grunt",
        team: spec.team,
        canSpawnSubagents: false,
        proposeTemplates: false,
        parentAgentId: parent.id,
        summary: spec.summary,
        instructions: spec.instructions,
        defaultGoal: "",
        inheritedPromptBlockIds: parent.inheritedPromptBlockIds,
        modelPolicy: pinnedMetaPolicy("complex", this.workspace.deniedModelIds),
        grants,
        allowedTools: tools,
        complexity: "complex",
        maxSteps: 8,
        dataClass: parent.dataClass,
        status: "active",
        version: 1,
        templateId: parent.templateId,
        createdAt: now,
        updatedAt: now,
      });

    if (!this.agentRows.some((row) => row.id === created.id)) this.agentRows.push(created);
    // Another run created it a moment ago: reuse it.
    if (!isNew) return created;

    this.#spawned.add(created.id);
    await this.logger.emit(
      {
        type: "agent.spawned",
        agentId: created.id,
        parentAgentId: parent.id,
        name: created.name,
        role: created.role as AgentRole,
        model: created.modelPolicy.pinnedModelId ?? provisionMetaModel("complex", this.workspace.deniedModelIds),
      },
      created.id,
    );
    await this.logger.emit(
      {
        type: "log",
        level: "info",
        message: `${parent.name} created ${spec.team}-team specialist ${created.name} (${created.id}).`,
        agentId: parent.id,
      },
      parent.id,
    );
    // Filed under the roster name, so per-case copies do not file one each.
    await this.#noteTemplateProposal(parent, {
      name: spec.name,
      summary: created.summary,
      instructions: created.instructions,
      tools: created.allowedTools,
      role,
      complexity: "complex",
      reason:
        spec.team === "red"
          ? `${parent.name} stood up ${created.name} as a probe it will reuse on later runs.`
          : `${parent.name} makes a ${spec.name} for each case it works.`,
    });

    return created;
  }

  /** A child worker with a narrower tool set. It reports back and cannot delegate. */
  async #spawnGrunt(
    parent: AgentRow,
    name: string,
    task: string,
    requestedTools: unknown,
    requestedConnectors?: unknown,
  ): Promise<AgentRow> {
    const now = new Date();
    const id = newId("agt");
    const cleanName = name.replace(/\s+/g, " ").trim().slice(0, 64);
    const slugBase = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "grunt";
    const slugTaken = this.agentRows.some(
      (row) => row.workspaceId === parent.workspaceId && row.slug === slugBase,
    );
    const slug = slugTaken ? `${slugBase}-${id.slice(4, 8)}` : slugBase;
    const requested = Array.isArray(requestedTools)
      ? requestedTools.filter((tool): tool is string => typeof tool === "string")
      : undefined;
    const granted = parseConnectorList(requestedConnectors).filter((slug) =>
      this.#connectorsFor(parent).includes(slug),
    );
    const tools = gruntTools(parent.allowedTools, requested);
    if (granted.length > 0) tools.push("connector.call");
    if (granted.includes(SERPAPI_TOOLKIT)) tools.push("web.search");

    const { row: created, created: isNew } = await insertHelperAgent({
        id,
        workspaceId: parent.workspaceId,
        name: cleanName,
        slug,
        role: "worker",
        rank: childRank(parent),
        canSpawnSubagents: false,
        proposeTemplates: false,
        parentAgentId: parent.id,
        summary: `Grunt for ${parent.name}. Reports only to that parent.`,
        instructions: [
          `You are ${cleanName}, a grunt reporting to ${parent.name}.`,
          "Do only the task your parent assigned. Return a short factual report: what you did, what you found, and the sources.",
          "Do not widen the task, do not make the parent's decision, and do not delegate.",
          `The task you were created for: ${task}`,
        ].join("\n"),
        defaultGoal: "",
        inheritedPromptBlockIds: parent.inheritedPromptBlockIds,
        modelPolicy: pinnedMetaPolicy(
          complexityForTask(task),
          this.workspace.deniedModelIds,
        ),
        // Cut from the parent's grants, so the grunt never holds more than the parent.
        grants: grantsFromParent(parent, tools),
        allowedTools: tools,
        allowedConnectors: granted,
        complexity: complexityForTask(task),
        maxSteps: 6,
        dataClass: parent.dataClass,
        status: "active",
        version: 1,
        templateId: parent.templateId,
        createdAt: now,
        updatedAt: now,
      });

    // A grunt reused from an earlier run may hold more than its parent does now. Hold it to the parent for this run.
    if (!isNew) Object.assign(created, clampToParent(created, parent));
    this.#spawnedGrunts.add(created.id);
    const known = this.agentRows.find((row) => row.id === created.id);
    if (known) Object.assign(known, { allowedTools: created.allowedTools, grants: created.grants });
    else this.agentRows.push(created);
    this.#runConnectors.set(created.id, granted);
    await persistConnectorGrants(this.run.workspaceId, created.id, granted, parent.id);
    if (!isNew) return created;
    this.#spawned.add(created.id);
    await this.logger.emit(
      {
        type: "agent.spawned",
        agentId: created.id,
        parentAgentId: parent.id,
        name: created.name,
        role: "worker",
        model: created.modelPolicy.pinnedModelId ?? provisionMetaModel("standard", this.workspace.deniedModelIds),
      },
      created.id,
    );
    await this.logger.emit(
      {
        type: "log",
        level: "info",
        message: `${parent.name} created grunt ${created.name} (${created.id}). It reports back to the parent.`,
        agentId: parent.id,
      },
      parent.id,
    );
    await this.#noteTemplateProposal(parent, {
      name: created.name,
      summary: created.summary,
      instructions: created.instructions,
      tools: created.allowedTools,
      role: "worker",
      complexity: "standard",
      reason: `${parent.name} created ${created.name} for a bounded task it expects to hand off again.`,
    });
    return created;
  }

  async #noteTemplateProposal(
    parent: AgentRow,
    proposal: {
      name: string;
      summary: string;
      instructions: string;
      tools: string[];
      role: "worker" | "security";
      complexity: "standard" | "complex";
      reason: string;
    },
  ): Promise<void> {
    const filed = await fileChildTemplateProposal({
      parent,
      runId: this.run.id,
      ...proposal,
    });
    if (!filed) return;
    await this.logger.emit(
      {
        type: "log",
        level: "info",
        message: `${parent.name} proposed a reusable template for ${proposal.name}. It is waiting for approval.`,
        agentId: parent.id,
      },
      parent.id,
    );
  }

  async #reportFinding(
    agent: AgentRow,
    call: { args: Record<string, unknown> },
  ): Promise<{ ok: boolean; preview: string; error?: string }> {
    const categories = [
      "prompt_injection",
      "data_exfiltration",
      "privilege_escalation",
      "secret_leak",
      "tool_abuse",
      "guardrail_bypass",
    ] as const;
    const severities = ["info", "low", "medium", "high", "critical"] as const;

    const title = argsString(call.args, "title");
    const detail = argsString(call.args, "detail");
    if (!title || !detail) {
      return { ok: false, preview: "", error: "security.report requires title and detail." };
    }

    const category = categories.includes(call.args.category as (typeof categories)[number])
      ? (call.args.category as (typeof categories)[number])
      : "guardrail_bypass";
    const severity = severities.includes(call.args.severity as (typeof severities)[number])
      ? (call.args.severity as (typeof severities)[number])
      : "medium";

    const findingId = newId("fnd");
    const targetAgentId = agent.parentAgentId;
    const safeDetail = redactSecrets(detail);
    const rawEvidence = argsString(call.args, "evidence");
    const evidence = rawEvidence ? redactSecrets(rawEvidence) : undefined;
    const rawRemediation = argsString(call.args, "remediation");
    const remediation = rawRemediation ? redactSecrets(rawRemediation) : undefined;

    await getDb().insert(securityFindings).values({
      id: findingId,
      workspaceId: this.run.workspaceId,
      runId: this.run.id,
      agentId: agent.id,
      targetAgentId,
      category,
      severity,
      title,
      detail: safeDetail,
      evidence: evidence ?? null,
      remediation: remediation ?? null,
      status: "open",
      createdAt: new Date(),
    });

    await this.logger.emit(
      {
        type: "security.finding",
        findingId,
        agentId: agent.id,
        targetAgentId,
        category,
        severity,
        title,
        detail: safeDetail,
        evidence,
        remediation,
      },
      agent.id,
    );

    // A finding the red-team lead reports itself is accepted by that lead: it
    // opens a case and sends it up the chain of command. Probers' findings
    // stay open until the lead or a person accepts them.
    const parent = agent.parentAgentId
      ? this.agentRows.find((row) => row.id === agent.parentAgentId)
      : undefined;
    const isLead = agent.role === "security" && parent?.role !== "security";
    if (isLead && targetAgentId && this.run.purpose !== "retest") {
      try {
        const loop = await import("@/lib/loop/cases");
        const opened = await loop.openCase(findingId, { kind: "agent", agentId: agent.id });
        await loop.elevateCase(opened.id);
        // The blue team takes it from here, when the workspace has one.
        const blue = await import("@/lib/loop/blue-team");
        await blue.advanceCase(opened.id);
      } catch (error) {
        await this.logger.emit(
          {
            type: "log",
            level: "warn",
            message: `finding ${findingId} recorded, but its case did not open: ${redactSecrets((error as Error).message)}`,
            agentId: agent.id,
          },
          agent.id,
        );
      }
    }

    return { ok: true, preview: `finding ${findingId} recorded at ${severity} severity` };
  }

  async #toolFailure(
    agent: AgentRow,
    callId: string,
    tool: string,
    durationMs: number,
    error: string,
  ): Promise<{ ok: false; preview: ""; error: string }> {
    await this.logger.emit(
      {
        type: "tool.completed",
        callId,
        agentId: agent.id,
        tool,
        ok: false,
        durationMs: Math.max(1, durationMs),
        error: redactSecrets(error).slice(0, 600),
      },
      agent.id,
    );
    await this.logger.emit(
      {
        type: "log",
        level: "warn",
        message: `${tool} refused: ${redactSecrets(error)}`,
        agentId: agent.id,
      },
      agent.id,
    );
    return { ok: false, preview: "", error };
  }

  #redactArgs(args: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string") {
        out[key] = redactSecrets(value).slice(0, 600);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /* --------------------------------------------------------------- run state */

  /**
   * Read through a method so TypeScript does not narrow the field across the
   * loop: `#setStatus` mutates it from a tool call several frames down.
   */
  #isHalted(): boolean {
    return this.#status === "halted";
  }

  #isCancelled(): boolean {
    if (cancelledRuns().has(this.run.id)) {
      this.#status = "cancelled";
      return true;
    }
    return this.#status === "cancelled";
  }

  async #setStatus(status: RunStatus, failureReason?: string): Promise<void> {
    this.#status = status;
    await getDb()
      .update(runs)
      .set({
        status,
        ...(failureReason ? { failureReason } : {}),
      })
      .where(eq(runs.id, this.run.id));
  }

  async #persistProgress(): Promise<void> {
    await getDb()
      .update(runs)
      .set({
        costUsd: this.costUsd,
        inputTokens: this.#inputTokens,
        outputTokens: this.#outputTokens,
        status: this.#status,
      })
      .where(eq(runs.id, this.run.id));
  }

  async #applyContextDirectives(agentId: string): Promise<void> {
    const file = new WorkspaceContextFile(env.sandboxRoot, this.run.workspaceId);
    file.ensure();
    for (const directive of parseContextDirectives(this.run.goal)) {
      file.apply(directive);
      await this.logger.emit(
        {
          type: "log",
          level: "info",
          message: `CONTEXT.md ${directive.op}: ${directive.text}`,
          agentId,
        },
        agentId,
      );
    }
  }

  async #loadConnectors(root: AgentRow): Promise<void> {
    const operatorId = this.run.operatorUserId;
    if (!operatorId) {
      this.#orchestratorConnectors = serpApiEnabled() ? [SERPAPI_TOOLKIT] : [];
      return;
    }
    try {
      this.#orchestratorConnectors = await connectedToolkitsFor(this.run.workspaceId, operatorId);
      await refreshContextCatalog(this.run.workspaceId, operatorId);
    } catch (error) {
      this.#orchestratorConnectors = serpApiEnabled() ? [SERPAPI_TOOLKIT] : [];
      await this.logger.emit(
        {
          type: "log",
          level: "warn",
          message: `Could not refresh connected apps: ${error instanceof Error ? error.message : "unknown error"}`,
          agentId: root.id,
        },
        root.id,
      );
    }
    if (this.#orchestratorConnectors.length > 0) {
      await this.logger.emit(
        {
          type: "log",
          level: "info",
          message: `Connected apps for this run: ${this.#orchestratorConnectors.join(", ")}`,
          agentId: root.id,
        },
        root.id,
      );
    }
  }

  #connectorsFor(agent: AgentRow): string[] {
    if (agent.role === "orchestrator") return this.#orchestratorConnectors;
    return this.#runConnectors.get(agent.id) ?? [];
  }

  async #maybeSpawnAdversarialSwarm(root: AgentRow): Promise<void> {
    // A manually selected or automatically arranged static tree stays as reviewed.
    if (root.sourceAgentId && !root.canSpawnSubagents) return;
    const hasRedTeam = this.agentRows.some(
      (row) =>
        row.parentAgentId === root.id &&
        row.role === "security" &&
        row.status !== "archived",
    );
    if (
      !shouldSpawnAdversarialSwarm({
        goal: this.run.goal,
        rootRole: root.role,
        hasRedTeam,
        securityRun: this.#scenario === "security",
      })
    ) {
      return;
    }

    const lead = await this.#ensureRedTeamLead(root);
    const childTaskId = newId("tsk");
    const brief = wantsDeploy(this.run.goal)
      ? "The parent just finished. Deploy the change in this workspace yourself, then stand up Injection Prober, Escalation Prober, and Egress Prober and return their findings."
      : "The parent just finished. Stand up Injection Prober, Escalation Prober, and Egress Prober against the work that landed and return their findings.";

    await this.logger.emit(
      {
        type: "task.created",
        taskId: childTaskId,
        agentId: lead.id,
        parentTaskId: null,
        title: "Adversarial swarm",
        detail: brief,
      },
      lead.id,
    );
    await this.logger.emit({ type: "task.updated", taskId: childTaskId, status: "running" }, lead.id);
    await this.logger.emit(
      {
        type: "handoff",
        fromAgentId: root.id,
        toAgentId: lead.id,
        summary: `${root.name} → ${lead.name}: adversarial pass`,
      },
      lead.id,
    );

    const result = await this.#runAgent(lead, childTaskId, 1, brief, root.id);
    await this.logger.emit(
      {
        type: "task.updated",
        taskId: childTaskId,
        status: result.status === "succeeded" ? "succeeded" : "failed",
        note: redactSecrets(result.summary).slice(0, 400),
      },
      lead.id,
    );
  }

  async #ensureRedTeamLead(parent: AgentRow): Promise<AgentRow> {
    const existing = this.agentRows.find(
      (row) =>
        row.parentAgentId === parent.id &&
        row.role === "security" &&
        redTeamSpecialist(row.name) === undefined,
    );
    if (existing) {
      if (existing.status === "archived") {
        const revived = await reactivateHelper(existing);
        Object.assign(existing, revived);
      }
      return existing;
    }

    const now = new Date();
    const id = newId("agt");
    const tools = [
      "agent.delegate",
      "fs.read",
      "fs.write",
      "fs.list",
      "kb.search",
      "http.fetch",
      "context.read",
      "security.report",
    ];
    const { row: created } = await insertHelperAgent({
      id,
      workspaceId: parent.workspaceId,
      name: "Red Team",
      slug: "red-team",
      role: "security",
      rank: childRank(parent) === "grunt" ? "intermediate" : childRank(parent),
      team: "red",
      canSpawnSubagents: true,
      proposeTemplates: false,
      parentAgentId: parent.id,
      summary: "Adversarial swarm lead. Deploys when asked, then stands up probe specialists.",
      instructions: [
        "You lead the red team.",
        "If the operator asked for a deploy, perform it in this workspace yourself first.",
        "Then do not run the probe vectors yourself. Delegate each one: Injection Prober, Escalation Prober, Egress Prober.",
        "Each specialist files its own finding. A denied credential request is the control working, not a finding.",
      ].join(" "),
      defaultGoal: "",
      inheritedPromptBlockIds: parent.inheritedPromptBlockIds,
      modelPolicy: pinnedMetaPolicy("complex", this.workspace.deniedModelIds),
      grants: grantsForSpecialist(tools),
      allowedTools: tools,
      complexity: "complex",
      maxSteps: 12,
      dataClass: parent.dataClass,
      status: "active",
      version: 1,
      templateId: parent.templateId,
      createdAt: now,
      updatedAt: now,
    });
    if (!this.agentRows.some((row) => row.id === created.id)) this.agentRows.push(created);
    await this.logger.emit(
      {
        type: "log",
        level: "info",
        message: `${parent.name} stood up ${created.name} (${created.id}) as an adversarial swarm lead.`,
        agentId: parent.id,
      },
      parent.id,
    );
    return created;
  }

  async #finish(status: RunStatus, summary: string, reason: string | null): Promise<void> {
    const db = getDb();
    const endedAt = new Date();
    await db
      .update(runs)
      .set({
        status,
        costUsd: this.costUsd,
        inputTokens: this.#inputTokens,
        outputTokens: this.#outputTokens,
        summary,
        failureReason: reason,
        endedAt,
        eventCount: this.logger.nextSeq,
      })
      .where(eq(runs.id, this.run.id));

    await db.insert(taskLog).values({
      id: newId("tl"),
      workspaceId: this.run.workspaceId,
      runId: this.run.id,
      agentId: this.run.agentId,
      title:
        this.run.goal.length > 72 ? `${this.run.goal.slice(0, 69)}…` : this.run.goal,
      summary,
      status,
      costUsd: this.costUsd,
      createdAt: endedAt,
    });

    if (this.run.triggerId) {
      await db
        .update(triggers)
        .set({ lastFiredAt: endedAt })
        .where(eq(triggers.id, this.run.triggerId));
    }

    const root = this.agentRows.find((row) => row.id === this.run.agentId);
    if (this.run.purpose === "retest" || (root && isBlueLead(root))) {
      // Imported lazily to keep the loop module out of the engine's import graph.
      try {
        const { noteRunFinished } = await import("@/lib/loop/blue-team");
        await noteRunFinished(this.run.id);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`[run ${this.run.id}] feedback-loop check failed`, error);
      }
    }
  }
}

function childRank(parent: AgentRow): AgentRank {
  return nextAgentRank(parent.rank) ?? "grunt";
}

function delegationGuidance(agent: AgentRow): string {
  if (agent.rank === "grunt") {
    return "\n\nYou are a grunt. Do the assigned task and report upward. You cannot create subagents or propose templates.";
  }
  // Team leads already get a closed roster in specialistRoster. Generic
  // "name a grunt" guidance made Red Team invent extra workers the platform
  // then refused.
  if (isProbeLead(agent) || isBlueLead(agent)) return "";
  const spawn = agent.canSpawnSubagents
    ? " Dynamic subagent creation is on: a missing child is created one rank below you."
    : " Dynamic subagent creation is off: you can only delegate to a child that already exists.";
  const approval = agent.proposeTemplates
    ? " Template proposal is on: a reusable child is filed for the operator to approve."
    : "";
  return `\n\n${DELEGATION_GUIDANCE}${spawn}${approval}`;
}

function specialistRoster(agent: AgentRow): string {
  if (isBlueLead(agent)) {
    const names = BLUE_TEAM_SPECIALISTS.map((spec) => spec.name).join(", ");
    return [
      "",
      "",
      "You lead the blue team. Do not triage, draft, or verify yourself.",
      `Delegate each step with agent.delegate, passing agent as one of: ${names}, and pass the case id as "case". Each is created for one case (a Verifier for one round) and retires when the case closes. Do not invent other agents.`,
      "The Verifier is never the Fix Drafter. A person approves every change; the platform applies it. Start a retest only with case.start_retest, after a Verifier has the round.",
    ].join("\n");
  }
  if (!isProbeLead(agent)) return "";
  const names = RED_TEAM_SPECIALISTS.map((spec) => spec.name).join(", ");
  return [
    "",
    "",
    "You lead the probe. Plan the probes from the run goal. Do not run the vectors yourself.",
    `Delegate each one with agent.delegate, passing agent as one of: ${names}. A specialist is created on first use and reused after that. Do not invent other agents or extra workers.`,
    "Each specialist files its own finding. A denied credential request is the control working, not a finding.",
    "Accept a finding only when its reproduction is exact: the input, the output or action observed, and the steps to repeat it.",
    SEVERITY_RUBRIC,
    "Test data is synthetic and labeled as test data, and stays in sandbox corpora. Use canary secrets only; a real secret never goes into a finding, a case, a diff, or a log.",
  ].join("\n");
}

/**
 * A specialist holds low and medium tools from its roster entry, never
 * delegation. The one exception is the Egress Prober's secret.use: asking is
 * the probe, and the engine always denies it to security agents.
 */
function specialistTools(tools: readonly string[]): string[] {
  return tools.filter((name) => {
    if (name === "agent.delegate" || name === "security.report") return false;
    if (name === "secret.use") return true;
    const entry = TOOL_BY_NAME.get(name) ?? CASE_TOOL_BY_NAME.get(name);
    return entry?.risk === "low" || entry?.risk === "medium";
  });
}

function complexityForTask(task: string, requested?: string | null): TaskComplexity {
  if (
    requested === "trivial" ||
    requested === "standard" ||
    requested === "complex" ||
    requested === "critical"
  ) {
    return requested;
  }
  if (/(critical|production|security|exploit|red.?team)/i.test(task)) return "complex";
  if (/(lookup|list|summar|triage|draft|status update)/i.test(task)) return "trivial";
  return "standard";
}

function pinnedMetaPolicy(complexity: TaskComplexity, deniedModelIds: readonly string[]): ModelPolicy {
  return {
    mode: "pinned",
    pinnedModelId: provisionMetaModel(complexity, deniedModelIds),
    costSensitivity: complexity === "trivial" ? 0.75 : 0.2,
    latencySensitivity: 0.15,
    floorComplexity: complexity === "trivial" ? "standard" : complexity,
    deniedModelIds: [],
  };
}

function grantsForSpecialist(tools: readonly string[]): PermissionGrant[] {
  const grants: PermissionGrant[] = [];
  for (const tool of tools) {
    const entry = TOOL_BY_NAME.get(tool);
    if (!entry || (entry.risk !== "low" && entry.risk !== "medium")) continue;
    grants.push({
      resource: entry.name,
      scopes: entry.scopes,
      // From the roster a person approved, never from the lead that spawned it.
      grantedBy: "team-roster",
      note: "Standing grant for a team specialist.",
    });
  }
  return grants;
}
