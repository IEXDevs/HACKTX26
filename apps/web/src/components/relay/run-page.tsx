import { RunView } from "./run-view";
import { duration, usd } from "@/lib/format";
import { getRun, getRunApprovals } from "@/lib/queries";
import { askFor, runLive, runTile } from "@/lib/views";

/**
 * Server half of the run view: loads one run and renders RunView. Shared by
 * the Runs page and workflow pages. Returns null when the run does not exist.
 */
export async function RunPage({ runId, embedded }: { runId: string; embedded?: boolean }) {
  const run = await getRun(runId);
  if (!run) return null;

  const [approvals, live] = await Promise.all([
    getRunApprovals(run.id),
    runLive(run.id, run.status, 200),
  ]);
  const tile = runTile({
    ...run,
    agentName: run.agent?.name ?? "Agent",
    agentRole: run.agent?.role ?? "orchestrator",
  });

  return (
    <RunView
      embedded={embedded}
      run={{
        ...live,
        history: live.history ?? [],
        id: run.id,
        agentId: run.agentId,
        name: tile.name,
        goal: run.goal,
        label: tile.label,
        tone: tile.tone,
        active: tile.group === "running" || tile.group === "waiting",
        result: run.failureReason ?? run.summary,
        elapsed: duration((run.endedAt?.getTime() ?? Date.now()) - run.startedAt.getTime()),
        cost: `${usd(run.costUsd)} of ${usd(run.budgetUsd)}`,
        approvals: approvals
          .filter((a) => a.status === "pending")
          .map((a) => ({ id: a.id, ask: askFor(a.resource), reason: a.reason })),
      }}
    />
  );
}
