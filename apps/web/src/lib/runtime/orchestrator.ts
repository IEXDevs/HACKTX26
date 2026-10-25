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
  estimateCostUsd,
  evaluatePermission,
  hardwareForComplexity,
  resolvePrompt,
  routeModel,
  type AgentConfig,
  type AgentRole,
  type DataClass,
  type RunEventPayload,
  type RunStatus,
  type Scope,
} from "@agent-os/core";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  agents,
  auditLog,
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
import { env, newId } from "@/lib/env";
import { redactSecrets } from "@/lib/secrets";
import { createApprovalRequest, waitForApprovalDecision } from "./approvals";
import { RunLogger } from "./emitter";
import { createLiveGateway, liveGatewayAvailable } from "./gateway";
import { ScriptedGateway } from "./gateway-scripted";
import { detectScenario, scriptFor, type Scenario } from "./scripts";
import { AgentSandbox } from "./sandbox";
import { ENGINE_TOOLS, executeTool, type ToolContext } from "./tools";
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
      .select({ cost: runs.costUsd, at: runs.startedAt })
      .from(runs)
      .where(eq(runs.workspaceId, options.workspaceId));
    const spentToday = today
      .filter((row) => row.at.getTime() >= startOfDay.getTime())
      .reduce((sum, row) => sum + row.cost, 0);
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
    startedAt: now,
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
  await engine.execute();
}

class RunEngine {
  readonly #ledger: BudgetLedger;
  readonly #runKey: string;
  readonly #scenario: Scenario;
  readonly #spawned = new Set<string>();
  readonly #grantedHighRisk = new Set<string>();
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

      const result = await this.#runAgent(root, null, 0, null);

      const summary = redactSecrets(result.summary || "Run completed with no final message.");
      const status: RunStatus =
        this.#status === "halted" || result.status === "halted" ? "halted" : result.status;
      const reason =
        status === "halted"
          ? `Halted by the run budget ceiling ($${this.run.budgetUsd.toFixed(2)}).`
          : null;

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

  async #runAgent(
    agent: AgentRow,
    taskId: string | null,
    depth: number,
    parentTask: string | null,
  ): Promise<AgentResult> {
    if (depth > MAX_DELEGATION_DEPTH) {
      return { status: "failed", summary: "Delegation depth limit reached." };
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
      new ScriptedGateway(scriptFor(this.#scenario, agent.name, agent.role as AgentRole), {
        chunkDelayMs: 0,
      });

    const messages: ModelMessage[] = [
      { role: "system", content: prompt.text },
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

    await this.logger.emit(
      { type: "agent.status", agentId: agent.id, status: "thinking" },
      agent.id,
    );

    for (let step = 0; step < agent.maxSteps; step++) {
      if (this.#isHalted()) {
        await this.logger.emit(
          { type: "agent.status", agentId: agent.id, status: "failed" },
          agent.id,
        );
        return { status: "halted", summary: "Budget ceiling reached mid-task." };
      }

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
        await this.logger.emit(
          { type: "agent.status", agentId: agent.id, status: "failed" },
          agent.id,
        );
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

    await this.logger.emit(
      { type: "agent.status", agentId: agent.id, status: "done" },
      agent.id,
    );

    return { status: "succeeded", summary: lastText || `${agent.name} finished.` };
  }

  #toolSpecs(agent: AgentRow): ToolSpec[] {
    const names = new Set(agent.allowedTools);
    if (agent.role === "orchestrator") names.add("agent.delegate");
    if (agent.role === "security") names.add("security.report");

    return [...names]
      .map((name) => TOOL_BY_NAME.get(name))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => ({
        name: entry.name,
        description: entry.description,
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
            summary: { type: "string" },
            scope: { type: "string" },
            kind: { type: "string" },
            severity: { type: "string" },
            category: { type: "string" },
            detail: { type: "string" },
            evidence: { type: "string" },
            remediation: { type: "string" },
          },
          additionalProperties: true,
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
    const manifest = TOOL_BY_NAME.get(call.name);
    const emitAsAgent = async (payload: RunEventPayload): Promise<void> => {
      await this.logger.emit(payload, agent.id);
    };

    const risk = manifest?.risk ?? "high";
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

    const roleAllowed =
      (call.name === "agent.delegate" && agent.role === "orchestrator") ||
      (call.name === "security.report" && agent.role === "security") ||
      agent.allowedTools.includes(call.name);

    if (!roleAllowed) {
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

    const decision = evaluatePermission({
      resource: call.name,
      scopes,
      risk,
      agentGrants: agent.grants,
      path,
      host,
    });

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
      const covered =
        manifest.risk === "high" && this.#grantedHighRisk.has(grantKey);

      if (!covered) {
        const approvalId = newId("apr");
        const reason =
          manifest.risk === "high" || manifest.risk === "critical"
            ? `${decision.reason} Risk is ${manifest.risk}, so this is a per-run human decision.`
            : decision.reason;

        await createApprovalRequest({
          id: approvalId,
          workspaceId: this.run.workspaceId,
          runId: this.run.id,
          agentId: agent.id,
          callId: call.id,
          resource: call.name,
          scopes: manifest.scopes,
          risk: manifest.risk,
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
            risk: manifest.risk,
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

        await getDb().insert(auditLog).values({
          id: newId("aud"),
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
          at: new Date(),
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
    } else {
      const ctx: ToolContext = {
        workspaceId: this.run.workspaceId,
        runId: this.run.id,
        agentId: agent.id,
        agentName: agent.name,
        sandbox,
        dataClass: this.run.dataClass,
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
    const requested = argsString(call.args, "agent");
    const title = argsString(call.args, "title") ?? "Delegated task";
    const task = argsString(call.args, "task") ?? "Complete the delegated task.";

    if (!requested) {
      return { ok: false, preview: "", error: "agent.delegate requires an agent name." };
    }

    const normalised = requested.toLowerCase();
    const child =
      this.agentRows.find(
        (row) =>
          row.parentAgentId === agent.id &&
          (row.name.toLowerCase() === normalised || row.id === requested || row.slug === normalised),
      ) ??
      this.agentRows.find(
        (row) => row.name.toLowerCase() === normalised || row.id === requested,
      );

    if (!child) {
      return {
        ok: false,
        preview: "",
        error: `No agent named "${requested}" is reachable from ${agent.name}.`,
      };
    }
    if (child.id === agent.id) {
      return { ok: false, preview: "", error: "An agent cannot delegate to itself." };
    }

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

    const result = await this.#runAgent(child, childTaskId, depth + 1, task);

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
      preview: `${child.name} (${childTaskId}) ${result.status} in ${Date.now() - started}ms\n${redactSecrets(result.summary).slice(0, 900)}`,
      ...(result.status === "succeeded" ? {} : { error: `${child.name} did not complete.` }),
    };
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

    await getDb().insert(securityFindings).values({
      id: findingId,
      workspaceId: this.run.workspaceId,
      runId: this.run.id,
      agentId: agent.id,
      targetAgentId,
      category,
      severity,
      title,
      detail: redactSecrets(detail),
      evidence: argsString(call.args, "evidence")
        ? redactSecrets(argsString(call.args, "evidence") as string)
        : null,
      remediation: argsString(call.args, "remediation")
        ? redactSecrets(argsString(call.args, "remediation") as string)
        : null,
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
        detail: redactSecrets(detail),
        evidence: argsString(call.args, "evidence")
          ? redactSecrets(argsString(call.args, "evidence") as string)
          : undefined,
        remediation: argsString(call.args, "remediation")
          ? redactSecrets(argsString(call.args, "remediation") as string)
          : undefined,
      },
      agent.id,
    );

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
  }
}
