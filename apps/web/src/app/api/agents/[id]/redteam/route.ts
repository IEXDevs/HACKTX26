import { and, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { agents, approvals } from "@/lib/db/schema";
import {
  CHECK_MAX_USD,
  listCheckReports,
  liveChecks,
  RED_TEAM_CATEGORIES,
  startRedTeamCheck,
} from "@/lib/loop/redteam-check";
import { getWorkspaceUser } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Where this agent's red-team check stands: running, finished, or never run. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { workspace } = await getWorkspaceUser();
  const [agent] = await (await getDb()).select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent || agent.workspaceId !== workspace.id) {
    return Response.json({ error: "Agent not found." }, { status: 404 });
  }
  const live = liveChecks().find((check) => check.agentId === id);
  if (live) {
    const pendingApprovals = live.runIds.length
      ? await (await getDb())
          .select({
            id: approvals.id,
            agentId: approvals.agentId,
            agentName: agents.name,
            runId: approvals.runId,
            resource: approvals.resource,
            scopes: approvals.scopes,
            risk: approvals.risk,
            reason: approvals.reason,
          })
          .from(approvals)
          .leftJoin(agents, eq(approvals.agentId, agents.id))
          .where(
            and(
              inArray(approvals.runId, live.runIds),
              eq(approvals.status, "pending"),
            ),
          )
          .orderBy(approvals.requestedAt)
      : [];
    return Response.json({
      state: "running",
      probesDone: live.probesDone,
      probesTotal: live.probesTotal,
      current: live.currentCategory,
      spentUsd: live.spentUsd,
      maxUsd: live.maxUsd,
      approvals: pendingApprovals,
    });
  }
  const report = (await listCheckReports(workspace.id, 50)).find((row) => row.agentId === id);
  if (!report) return Response.json({ state: "none" });
  return Response.json({ state: "finished", findings: report.findingIds.length, at: report.at });
}

/**
 * Start a red-team check on one published agent. A person asks for it after
 * seeing that it spends tokens. Runs start in the background, one at a time.
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { workspace, user } = await getWorkspaceUser();
  const [agent] = await (await getDb()).select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent || agent.workspaceId !== workspace.id) {
    return Response.json({ error: "Agent not found." }, { status: 404 });
  }
  if (agent.status !== "active") {
    return Response.json({ error: `${agent.name} is not published yet.` }, { status: 409 });
  }
  try {
    startRedTeamCheck(agent.id, user?.email ?? "operator@local");
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 409 });
  }
  return Response.json(
    { started: true, probes: RED_TEAM_CATEGORIES.length, maxUsd: CHECK_MAX_USD },
    { status: 202 },
  );
}
