/**
 * Per-workflow bubble map. A workflow is a root agent plus its team; the
 * canvas never mixes two workflows into one constellation.
 */
import {
  MODEL_BY_ID,
  projectRun,
  routeModel,
  type DataClass,
  type ProjectedAgent,
  type TaskComplexity,
} from "@agent-os/core";
import type { AgentRow } from "./db/schema";
import { foldRunHistory, type HistoryItem } from "./views";
import {
  getRunEvents,
  getWorkspace,
  listAgents,
  listBudgetPolicies,
  listFindings,
  listRuns,
  listTaskLog,
} from "./queries";

export interface GraphAgent {
  /** Empty builder slot. Its plus button opens the existing-agent picker. */
  placeholder?: boolean;
  id: string;
  name: string;
  role: string;
  status: string;
  summary: string;
  parentAgentId: string | null;
  model: string;
  /** Catalog id of the model the agent runs on, when known. Colors the node. */
  modelId: string | null;
  /** Model provider, e.g. "meta" or "anthropic". Picks the mark in the node. */
  provider: string;
  complexity: string;
  dataClass: string;
  tools: string[];
  grants: { resource: string; scopes: string[]; paths?: string[] }[];
  maxSteps: number;
  version: number;
  lastRun: { id: string; status: string; at: string } | null;
  openFindings: number;
  budgetUsd: number | null;
  spentUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number | null;
  filesTouched: string[];
  diff: { reads: number; writes: number; deletes: number };
  trailHref: string;
  consoleHref: string;
  kind: "orchestrator" | "worker" | "security" | "swarm";
  rank: string;
  createdAt: string;
}

export interface GraphTask {
  agentId: string;
  runId: string;
  title: string;
  status: string;
  at: string;
}

export interface GraphFlow {
  fromId: string;
  toId: string;
  kind: "own" | "info";
}

export interface GraphSnapshot {
  workflowId: string;
  workflowName: string;
  agents: GraphAgent[];
  tasks: GraphTask[];
  flows: GraphFlow[];
  activity: HistoryItem[];
  liveRunId: string | null;
  now: string;
  live: boolean;
}

function teamIds(all: AgentRow[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  const walk = (id: string) => {
    for (const child of all.filter((a) => a.parentAgentId === id)) {
      ids.add(child.id);
      walk(child.id);
    }
  };
  walk(rootId);
  return ids;
}

const FALLBACK_MODEL = "muse-spark-1.3";

function liveRunStatus(liveStatus: string | undefined, fallback?: string): string | undefined {
  if (liveStatus === "thinking" || liveStatus === "working") return "running";
  if (liveStatus === "blocked") return "awaiting_approval";
  if (liveStatus === "failed") return "failed";
  if (liveStatus === "done") return "succeeded";
  return fallback;
}

function ghostAgent(projected: ProjectedAgent, runId: string, runAt: string): GraphAgent {
  const catalog = MODEL_BY_ID.get(projected.model);
  const status = liveRunStatus(projected.status, "running") ?? "running";
  const kind: GraphAgent["kind"] =
    projected.role === "security"
      ? projected.parentAgentId
        ? "swarm"
        : "security"
      : projected.role === "orchestrator"
        ? "orchestrator"
        : "worker";
  const started = new Date(projected.spawnedAt).getTime();
  return {
    id: projected.id,
    name: projected.name,
    role: projected.role,
    status: "active",
    summary: "Stood up during this run.",
    parentAgentId: projected.parentAgentId,
    model: catalog?.label ?? projected.model,
    modelId: catalog ? projected.model : null,
    provider: catalog?.provider ?? "unknown",
    complexity: "standard",
    dataClass: "internal",
    tools: [],
    grants: [],
    maxSteps: 6,
    version: 1,
    lastRun: { id: runId, status, at: runAt },
    openFindings: 0,
    budgetUsd: null,
    spentUsd: projected.costUsd,
    inputTokens: projected.promptTokens,
    outputTokens: projected.completionTokens,
    durationMs: Number.isFinite(started) ? Math.max(0, Date.now() - started) : null,
    filesTouched: [],
    diff: { reads: 0, writes: 0, deletes: 0 },
    trailHref: `/agents/${projected.id}/trail`,
    consoleHref: `/agents/${projected.id}/console`,
    kind,
    rank: "grunt",
    createdAt: projected.spawnedAt,
  };
}

/** The model an agent ran on, or the one the router would pick for it now. */
function provisionedModel(agent: AgentRow, deniedModelIds: string[], recorded?: string | null): string {
  if (recorded && MODEL_BY_ID.has(recorded)) return recorded;
  try {
    const result = routeModel({
      complexity: agent.complexity as TaskComplexity,
      dataClass: agent.dataClass as DataClass,
      requiredCapabilities: ["tool_calling"],
      estimatedInputTokens: 4000,
      estimatedOutputTokens: 900,
      costSensitivity: agent.modelPolicy.costSensitivity,
      latencySensitivity: agent.modelPolicy.latencySensitivity,
      pinnedModelId:
        agent.modelPolicy.mode === "pinned" ? (agent.modelPolicy.pinnedModelId ?? undefined) : undefined,
      deniedModelIds: [...deniedModelIds, ...agent.modelPolicy.deniedModelIds],
    });
    return result.chosenModel;
  } catch {
    return FALLBACK_MODEL;
  }
}

export async function workflowGraph(
  workspaceId: string,
  workflowId: string,
): Promise<GraphSnapshot | null> {
  const [agents, runs, findings, policies, taskRows, workspace] = await Promise.all([
    listAgents(workspaceId),
    listRuns(workspaceId, { limit: 200 }),
    listFindings(workspaceId, 100),
    listBudgetPolicies(workspaceId),
    listTaskLog(workspaceId, 80),
    getWorkspace(),
  ]);
  const denied = workspace?.deniedModelIds ?? [];

  const root = agents.find((agent) => agent.id === workflowId && agent.parentAgentId === null);
  if (!root) return null;

  const ids = teamIds(agents, root.id);
  const latestWorkflowRun = runs.find((run) => ids.has(run.agentId)) ?? null;
  const runEvents = latestWorkflowRun ? await getRunEvents(latestWorkflowRun.id) : [];
  const projection = latestWorkflowRun ? projectRun(runEvents, latestWorkflowRun.id) : null;

  const visible = agents.filter((agent) => {
    if (!ids.has(agent.id)) return false;
    if (agent.status !== "archived") return true;
    return Boolean(projection?.agents.has(agent.id));
  });

  const graphAgents: GraphAgent[] = visible.map((agent) => {
    const projected = projection?.agents.get(agent.id);
    const ownRun = runs.find((run) => run.agentId === agent.id);
    const latest = ownRun ?? (projected && latestWorkflowRun ? latestWorkflowRun : null);
    const runBudget = policies.find((policy) => policy.agentId === agent.id && policy.period === "run");
    const files = (projection?.files ?? []).filter((file) => file.agentId === agent.id);
    const writes = files.filter((file) => file.op === "created" || file.op === "updated");
    const started = projected?.spawnedAt ? new Date(projected.spawnedAt).getTime() : latest?.startedAt.getTime() ?? null;
    const ended = latest?.endedAt?.getTime() ?? (projection?.endedAt ? new Date(projection.endedAt).getTime() : null);
    const liveStatus = projected?.status;
    const runStatus = liveRunStatus(liveStatus, latest?.status);
    const provisioned = projected?.model || (agent.modelPolicy.mode === "pinned" ? agent.modelPolicy.pinnedModelId : null);
    const modelId = provisionedModel(agent, denied, provisioned);
    const catalog = MODEL_BY_ID.get(modelId);
    const kind: GraphAgent["kind"] =
      agent.role === "security"
        ? agent.parentAgentId && agents.find((row) => row.id === agent.parentAgentId)?.role === "security"
          ? "swarm"
          : "security"
        : agent.role === "orchestrator"
          ? "orchestrator"
          : "worker";

    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      summary: agent.summary,
      parentAgentId: agent.parentAgentId,
      model: catalog?.label ?? modelId,
      modelId: catalog ? modelId : null,
      provider: catalog?.provider ?? "unknown",
      complexity: agent.complexity,
      dataClass: agent.dataClass,
      tools: agent.allowedTools,
      grants: agent.grants.map((grant) => ({
        resource: grant.resource,
        scopes: grant.scopes,
        paths: grant.constraints?.paths,
      })),
      maxSteps: agent.maxSteps,
      version: agent.version,
      lastRun: latest
        ? { id: latest.id, status: runStatus ?? latest.status, at: latest.startedAt.toISOString() }
        : null,
      openFindings: findings.filter(
        (finding) => finding.targetAgentId === agent.id && finding.status === "open",
      ).length,
      budgetUsd: runBudget?.limitUsd ?? null,
      spentUsd: projected?.costUsd ?? latest?.costUsd ?? 0,
      inputTokens: projected?.promptTokens ?? latest?.inputTokens ?? 0,
      outputTokens: projected?.completionTokens ?? latest?.outputTokens ?? 0,
      durationMs:
        started && ended
          ? Math.max(0, ended - started)
          : started && (runStatus === "running" || runStatus === "queued" || runStatus === "awaiting_approval")
            ? Math.max(0, Date.now() - started)
            : null,
      filesTouched: [...new Set(files.map((file) => file.path))],
      diff: {
        reads: files.filter((file) => file.op === "read").length,
        writes: writes.length,
        deletes: files.filter((file) => file.op === "deleted").length,
      },
      trailHref: `/agents/${agent.id}/trail`,
      consoleHref: `/agents/${agent.id}/console`,
      kind,
      rank: agent.rank,
      createdAt: agent.createdAt.toISOString(),
    };
  });

  if (projection && latestWorkflowRun) {
    const known = new Set(graphAgents.map((agent) => agent.id));
    for (const projected of projection.agents.values()) {
      if (known.has(projected.id)) continue;
      graphAgents.push(
        ghostAgent(projected, latestWorkflowRun.id, latestWorkflowRun.startedAt.toISOString()),
      );
      known.add(projected.id);
      ids.add(projected.id);
    }
  }

  const flows: GraphFlow[] = [];
  for (const handoff of projection?.handoffs ?? []) {
    if (ids.has(handoff.fromAgentId) && ids.has(handoff.toAgentId)) {
      flows.push({ fromId: handoff.fromAgentId, toId: handoff.toAgentId, kind: "info" });
    }
  }

  const tasks: GraphTask[] = taskRows
    .filter((task) => ids.has(task.agentId))
    .map((task) => ({
      agentId: task.agentId,
      runId: task.runId,
      title: task.title,
      status: task.status,
      at: task.createdAt.toISOString(),
    }));

  const live = Boolean(
    latestWorkflowRun &&
      (latestWorkflowRun.status === "running" ||
        latestWorkflowRun.status === "queued" ||
        latestWorkflowRun.status === "awaiting_approval"),
  );
  const nameOf = (id: string) =>
    graphAgents.find((agent) => agent.id === id)?.name ??
    projection?.agents.get(id)?.name ??
    "Agent";
  const activity = latestWorkflowRun ? foldRunHistory(runEvents, nameOf) : [];
  const working = [...(projection?.tasks.values() ?? [])].find((task) => task.status === "running");
  const now = working
    ? `${nameOf(working.agentId)}: ${working.title}`
    : live
      ? activity.at(-1)?.text || "Working"
      : "";

  return {
    workflowId: root.id,
    workflowName: root.name,
    agents: graphAgents,
    tasks,
    flows,
    activity: activity.slice(-48),
    liveRunId: live ? latestWorkflowRun?.id ?? null : null,
    now,
    live,
  };
}
