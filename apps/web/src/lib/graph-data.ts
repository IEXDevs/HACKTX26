/**
 * Per-workflow bubble map. A workflow is a root agent plus its team; the
 * canvas never mixes two workflows into one constellation.
 */
import { MODEL_BY_ID, projectRun, routeModel, type DataClass, type TaskComplexity } from "@agent-os/core";
import type { AgentRow } from "./db/schema";
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
  const projection = latestWorkflowRun ? projectRun(await getRunEvents(latestWorkflowRun.id), latestWorkflowRun.id) : null;

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
    const runStatus =
      liveStatus === "thinking" || liveStatus === "working"
        ? "running"
        : liveStatus === "blocked"
          ? "awaiting_approval"
          : liveStatus === "failed"
            ? "failed"
            : liveStatus === "done"
              ? "succeeded"
              : latest?.status;
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
    };
  });

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

  return {
    workflowId: root.id,
    workflowName: root.name,
    agents: graphAgents,
    tasks,
    flows,
    live,
  };
}
