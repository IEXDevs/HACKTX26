import { eq } from "drizzle-orm";
import { verifyChain } from "@agent-os/core";
import { RunView } from "./run-view";
import { RunTrace } from "@/components/runs/run-trace";
import { getDb } from "@/lib/db/client";
import { triggers } from "@/lib/db/schema";
import { duration, usd } from "@/lib/format";
import { getRun, getRunApprovals, getRunEvents, listAgents } from "@/lib/queries";
import { askFor, runLive, runTile } from "@/lib/views";

/**
 * Server half of the run view: loads one run and renders RunView. Shared by
 * the Runs page and workflow pages. Returns null when the run does not exist.
 */
export async function RunPage({ runId, embedded }: { runId: string; embedded?: boolean }) {
  const run = await getRun(runId);
  if (!run) return null;

  const [events, agents, triggerRow, approvals, live] = await Promise.all([
    getRunEvents(run.id),
    listAgents(run.workspaceId),
    run.triggerId
      ? getDb().select().from(triggers).where(eq(triggers.id, run.triggerId)).limit(1)
      : Promise.resolve([]),
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
        id: run.id,
        agentId: run.agentId,
        name: tile.name,
        goal: run.goal,
        label: tile.label,
        tone: tile.tone,
        active: tile.group === "running",
        result: run.failureReason ?? run.summary,
        elapsed: duration((run.endedAt?.getTime() ?? Date.now()) - run.startedAt.getTime()),
        cost: `${usd(run.costUsd)} of ${usd(run.budgetUsd)}`,
        approvals: approvals
          .filter((a) => a.status === "pending")
          .map((a) => ({ id: a.id, ask: askFor(a.resource), reason: a.reason })),
      }}
      trace={
        <RunTrace
          run={{
            id: run.id,
            goal: run.goal,
            status: run.status,
            dataClass: run.dataClass,
            mode: run.mode,
            trigger: triggerRow[0]?.kind ?? null,
            budgetUsd: run.budgetUsd,
            costUsd: run.costUsd,
            inputTokens: run.inputTokens,
            outputTokens: run.outputTokens,
            startedAt: run.startedAt.toISOString(),
            endedAt: run.endedAt ? run.endedAt.toISOString() : null,
            failureReason: run.failureReason,
            summary: run.summary,
          }}
          initialEvents={events}
          agents={agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            role: agent.role,
            parentAgentId: agent.parentAgentId,
          }))}
          chain={verifyChain(events)}
        />
      }
    />
  );
}
