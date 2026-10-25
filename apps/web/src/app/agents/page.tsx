import { AgentsGrid, type AgentTile } from "@/components/relay/agents-grid";
import { usd } from "@/lib/format";
import { listAgents, listRuns, requireWorkspace } from "@/lib/queries";
import { routedModel } from "@/lib/views";

export default async function AgentsPage() {
  const workspace = await requireWorkspace();
  const [agents, runs] = await Promise.all([
    listAgents(workspace.id),
    listRuns(workspace.id, { limit: 1000 }),
  ]);
  const tiles: AgentTile[] = agents
    .filter((agent) => agent.parentAgentId === null)
    .map((agent) => {
      const own = runs.filter((run) => run.agentId === agent.id);
      return {
        id: agent.id,
        name: agent.name,
        summary: agent.summary,
        status: agent.status,
        defaultGoal: agent.defaultGoal,
        role: agent.role,
        team: agents.filter((child) => child.parentAgentId === agent.id).length,
        runs: own.length,
        model: routedModel(agent),
        spend: usd(own.reduce((sum, run) => sum + run.costUsd, 0)),
      };
    });
  return <AgentsGrid agents={tiles} />;
}
