import { GraphSpace, type GraphTask, type GraphAgent } from "@/components/graph/graph-space";
import {
  getWorkspaceContext,
  listAgents,
  listBudgetPolicies,
  listFindings,
  listRuns,
  listTaskLog,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const ctx = await getWorkspaceContext();
  const wsId = ctx.workspace.id;

  const [agents, runs, findings, policies, taskRows] = await Promise.all([
    listAgents(wsId),
    listRuns(wsId, { limit: 120 }),
    listFindings(wsId, 100),
    listBudgetPolicies(wsId),
    listTaskLog(wsId, 60),
  ]);

  const graphAgents: GraphAgent[] = agents.map((agent) => {
    const latest = runs.find((run) => run.agentId === agent.id);
    const runBudget = policies.find(
      (policy) => policy.agentId === agent.id && policy.period === "run",
    );
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      summary: agent.summary,
      parentAgentId: agent.parentAgentId,
      model:
        agent.modelPolicy.mode === "pinned"
          ? (agent.modelPolicy.pinnedModelId ?? "pinned")
          : agent.modelPolicy.floorComplexity === "critical"
            ? "auto · complex floor"
            : "auto-routed",
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
        ? { id: latest.id, status: latest.status, at: latest.startedAt.toISOString() }
        : null,
      openFindings: findings.filter(
        (finding) => finding.targetAgentId === agent.id && finding.status === "open",
      ).length,
      budgetUsd: runBudget?.limitUsd ?? null,
      spentUsd: latest?.costUsd ?? 0,
    };
  });

  const tasks: GraphTask[] = taskRows.map((task) => ({
    agentId: task.agentId,
    runId: task.runId,
    title: task.title,
    status: task.status,
    at: task.createdAt.toISOString(),
  }));

  // full-bleed: the map owns the whole viewport under the top bar
  return (
    <div className="-mx-4 -my-6 h-[calc(100dvh-48px)] lg:-mx-6">
      <GraphSpace
        agents={graphAgents}
        tasks={tasks}
        dispatchAgents={agents.map((agent) => {
          const policy = policies.find(
            (entry) => entry.agentId === agent.id && entry.period === "run",
          );
          return {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            status: agent.status,
            dataClass: agent.dataClass,
            runBudgetUsd: policy?.limitUsd ?? null,
          };
        })}
      />
    </div>
  );
}
