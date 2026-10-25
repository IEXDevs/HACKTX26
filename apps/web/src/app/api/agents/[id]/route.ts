import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { buildGraph, validateGraph, type AgentConfig } from "@agent-os/core";
import { treeContaining } from "@/lib/agent-tree";
import { getDb } from "@/lib/db/client";
import { agents, auditLog } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Body = z.object({
  status: z.enum(["draft", "active", "paused", "archived"]),
});

function toConfig(row: typeof agents.$inferSelect): AgentConfig {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    role: row.role,
    parentAgentId: row.parentAgentId,
    summary: row.summary,
    instructions: row.instructions,
    inheritedPromptBlockIds: row.inheritedPromptBlockIds,
    modelPolicy: row.modelPolicy,
    grants: row.grants,
    allowedTools: row.allowedTools,
    complexity: row.complexity,
    maxSteps: row.maxSteps,
    dataClass: row.dataClass,
    status: row.status,
    version: row.version,
    templateId: row.templateId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Promotion to `active` re-validates the whole graph first. A draft with a
 * broken parent pointer or an admin grant cannot be made runnable by flipping
 * a flag in the UI.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { status }." }, { status: 400 });
  }

  const workspace = await requireWorkspace();
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent || agent.workspaceId !== workspace.id) {
    return Response.json({ error: "Agent not found." }, { status: 404 });
  }

  if (parsed.data.status === "active") {
    const all = await db.select().from(agents).where(eq(agents.workspaceId, workspace.id));
    const next = all.map((row) => (row.id === id ? { ...row, status: "active" as const } : row));
    // Only this agent's own team is checked. The rest of the workspace is not its problem.
    const issues = validateGraph(buildGraph(treeContaining(next, id).map(toConfig)));
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      return Response.json(
        { error: `Graph is invalid. ${errors.map((issue) => issue.message).join(" ")}`, issues },
        { status: 409 },
      );
    }
  }

  const [updated] = await db
    .update(agents)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(agents.id, id))
    .returning();

  const { user } = await getWorkspaceUser();
  await db.insert(auditLog).values({
    id: newId("aud"),
    workspaceId: workspace.id,
    actor: user?.email ?? "operator@local",
    action: `agent.${parsed.data.status}`,
    targetType: "agent",
    targetId: id,
    detail: { from: agent.status, to: parsed.data.status, version: agent.version },
    at: new Date(),
  });

  return Response.json({ agent: updated });
}
