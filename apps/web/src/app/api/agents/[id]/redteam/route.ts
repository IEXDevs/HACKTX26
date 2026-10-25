import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";
import { CHECK_MAX_USD, RED_TEAM_CATEGORIES, startRedTeamCheck } from "@/lib/loop/redteam-check";
import { getWorkspaceContext } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Start a red-team check on one published agent. A person asks for it after
 * seeing that it spends tokens. Runs start in the background, one at a time.
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { workspace, user } = await getWorkspaceContext();
  const [agent] = await getDb().select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent || agent.workspaceId !== workspace.id) {
    return Response.json({ error: "Agent not found." }, { status: 404 });
  }
  if (agent.status !== "active") {
    return Response.json({ error: `${agent.name} is not published yet.` }, { status: 409 });
  }
  startRedTeamCheck(agent.id, user?.email ?? "operator@local");
  return Response.json(
    { started: true, probes: RED_TEAM_CATEGORIES.length, maxUsd: CHECK_MAX_USD },
    { status: 202 },
  );
}
