import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { operatorIdFor } from "@/lib/connectors";
import { env } from "@/lib/env";
import { ensureGithubCheckout, refreshGithubCache } from "@/lib/github-sync";
import { getAgent, getWorkspaceUser } from "@/lib/queries";
import { AgentSandbox } from "@/lib/runtime/sandbox";

export const dynamic = "force-dynamic";

const Body = z.object({
  agentId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Expected { agentId? }." }, { status: 400 });
  }
  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();
  const operatorId = operatorIdFor(session?.id, user?.id);
  try {
    if (parsed.data.agentId) {
      const agent = await getAgent(parsed.data.agentId);
      if (!agent || agent.workspaceId !== workspace.id) {
        return Response.json({ error: "Agent not found." }, { status: 404 });
      }
      const sandbox = new AgentSandbox(env.sandboxRoot, workspace.id, agent.id);
      sandbox.provision();
      const result = await ensureGithubCheckout({
        sandbox,
        workspaceId: workspace.id,
        userId: operatorId,
      });
      return Response.json(result);
    }
    const result = await refreshGithubCache({ workspaceId: workspace.id, userId: operatorId });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
