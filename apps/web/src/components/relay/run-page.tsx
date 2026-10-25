import { RunView } from "./run-view";
import { duration, relativeTime, usd } from "@/lib/format";
import { getRun, getRunApprovals } from "@/lib/queries";
import { askFor, runLive, runTile } from "@/lib/views";
import { listPendingInputs } from "@/lib/runtime/run-input";

/**
 * Server half of the run view: loads one run and renders RunView. Shared by
 * the Runs page and workflow pages. Returns null when the run does not exist.
 */
export async function RunPage({ runId, embedded }: { runId: string; embedded?: boolean }) {
  const run = await getRun(runId);
  if (!run) return null;

  const [approvals, live, questions] = await Promise.all([
    getRunApprovals(run.id),
    runLive(run.id, run.status, 200),
    listPendingInputs(run.workspaceId, run.id),
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
        result: run.summary ?? run.failureReason,
        failureReason: run.failureReason,
        inputs: questions.map((question) => ({ id: question.id, runId: run.id, workflow: run.agent?.name ?? "Agent", ask: question.question,
          preview: question.reason, waiting: relativeTime(question.requestedAt).replace(" ago", "") })),
        elapsed: duration((run.endedAt?.getTime() ?? Date.now()) - run.startedAt.getTime()),
        cost: `${usd(run.costUsd)} of ${usd(run.budgetUsd)}`,
        approvals: approvals
          .filter((a) => a.status === "pending")
          .map((a) => ({ id: a.id, ask: askFor(a.resource), reason: a.reason })),
      }}
    />
  );
}
