import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { verifyChain } from "@agent-os/core";
import { RunTrace } from "@/components/runs/run-trace";
import { getDb } from "@/lib/db/client";
import { triggers } from "@/lib/db/schema";
import { getRun, getRunEvents, listAgents } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();

  const [events, agents, triggerRow] = await Promise.all([
    getRunEvents(run.id),
    listAgents(run.workspaceId),
    run.triggerId
      ? getDb().select().from(triggers).where(eq(triggers.id, run.triggerId)).limit(1)
      : Promise.resolve([]),
  ]);

  const chain = verifyChain(events);

  return (
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
      chain={chain}
    />
  );
}
