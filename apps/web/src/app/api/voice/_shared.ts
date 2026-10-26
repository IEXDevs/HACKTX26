/** Shared checks for the voice-line routes: who is calling, and which agent answers. */
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { operatorIdFor } from "@/lib/connectors";
import { getDb } from "@/lib/db/client";
import { agents, runs, type AgentRow, type RunRow, type Workspace } from "@/lib/db/schema";
import { supabaseAuthEnabled } from "@/lib/env";
import { getWorkspaceUser } from "@/lib/queries";
import { VOICE_GOAL } from "@/lib/voice-line";

export type VoiceContext =
  | {
      ok: true;
      workspace: Workspace;
      agent: AgentRow;
      operatorUserId: string;
      actor: string;
      userId: string | null;
    }
  | { ok: false; response: Response };

/** The signed-in operator and an agent of their workspace that is not archived. */
export async function voiceContext(agentId: string): Promise<VoiceContext> {
  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();
  if (supabaseAuthEnabled() && !session?.id) {
    return { ok: false, response: Response.json({ error: "Sign in required." }, { status: 401 }) };
  }
  const [agent] = await (await getDb()).select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent || agent.workspaceId !== workspace.id || agent.status === "archived") {
    return { ok: false, response: Response.json({ error: "That agent was not found." }, { status: 404 }) };
  }
  return {
    ok: true,
    workspace,
    agent,
    operatorUserId: operatorIdFor(session?.id, user?.id),
    actor: user?.email ?? session?.email ?? "operator@local",
    userId: user?.id ?? null,
  };
}

/** A voice call this operator started with this agent. */
export async function voiceRun(
  ctx: Extract<VoiceContext, { ok: true }>,
  runId: string,
): Promise<RunRow | null> {
  const [run] = await (await getDb()).select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (
    !run ||
    run.workspaceId !== ctx.workspace.id ||
    run.agentId !== ctx.agent.id ||
    run.goal !== VOICE_GOAL ||
    run.operatorUserId !== ctx.operatorUserId
  ) {
    return null;
  }
  return run;
}
