import { RunsGrid } from "@/components/relay/runs-grid";
import { listAgents, listRuns, requireWorkspace } from "@/lib/queries";
import { summarizeRuns } from "@/lib/run-stats";
import { runTile } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const workspace = await requireWorkspace();
  const [runs, agents] = await Promise.all([
    listRuns(workspace.id, { limit: 1000 }),
    listAgents(workspace.id),
  ]);
  return (
    <RunsGrid
      runs={runs.map(runTile)}
      kpis={summarizeRuns(runs)}
      agents={agents
        .filter((agent) => agent.parentAgentId === null)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          status: agent.status,
          defaultGoal: agent.defaultGoal,
        }))}
    />
  );
}
