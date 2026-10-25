import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";
import {
  CHECK_MAX_USD,
  CHECK_RUN_BUDGET_USD,
  liveChecks,
  probeCountForLimit,
  startRedTeamCheck,
} from "@/lib/loop/redteam-check";
import { getWorkspaceContext } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Body = z.object({
  agentId: z.string().min(1),
  limitUsd: z.number().min(CHECK_RUN_BUDGET_USD).max(10),
});

/**
 * Start an automated security test: pick a published agent and a spend cap,
 * then run one labeled probe per attack type that fits in the cap.
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: `Pick an agent and a limit of at least $${CHECK_RUN_BUDGET_USD.toFixed(2)}.` },
      { status: 400 },
    );
  }

  const { workspace, user } = await getWorkspaceContext();
  const [agent] = await getDb().select().from(agents).where(eq(agents.id, parsed.data.agentId)).limit(1);
  if (!agent || agent.workspaceId !== workspace.id) {
    return Response.json({ error: "Agent not found." }, { status: 404 });
  }
  if (agent.status !== "active") {
    return Response.json({ error: `${agent.name} is not published yet.` }, { status: 409 });
  }
  if (agent.role === "security") {
    return Response.json({ error: "Pick an agent to test, not a security checker." }, { status: 400 });
  }

  const probes = probeCountForLimit(parsed.data.limitUsd);
  if (probes < 1) {
    return Response.json(
      { error: `Limit must cover at least one probe ($${CHECK_RUN_BUDGET_USD.toFixed(2)}).` },
      { status: 400 },
    );
  }

  try {
    startRedTeamCheck(agent.id, user?.email ?? "operator@local", { maxUsd: parsed.data.limitUsd });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 409 });
  }

  return Response.json(
    {
      started: true,
      agentId: agent.id,
      agentName: agent.name,
      probes,
      maxUsd: Math.min(parsed.data.limitUsd, CHECK_MAX_USD),
      live: liveChecks().find((check) => check.agentId === agent.id) ?? null,
    },
    { status: 202 },
  );
}
