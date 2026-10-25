import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceContext, requireWorkspace } from "@/lib/queries";
import { composeAgent } from "@/lib/runtime/compose-agent";

export const dynamic = "force-dynamic";

const Body = z.object({
  useCase: z.string().min(12).max(4_000),
});

/**
 * Drafts an agent blueprint from a use case. Nothing is written to `agents`.
 * The builder reviews the system prompt and the goal, then POSTs /api/agents.
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Describe the use case in at least a sentence." },
      { status: 400 },
    );
  }

  const workspace = await requireWorkspace();
  const result = await composeAgent(parsed.data.useCase);

  const { user } = await getWorkspaceContext();
  await getDb().insert(auditLog).values({
    id: newId("aud"),
    workspaceId: workspace.id,
    actor: user?.email ?? "operator@local",
    action: "agent.compose_draft",
    targetType: "agent",
    targetId: "draft",
    detail: {
      source: result.source,
      model: result.model,
      name: result.draft.name,
      dataClass: result.draft.dataClass,
      complexity: result.draft.complexity,
      tools: result.draft.allowedTools,
    },
    at: new Date(),
  });

  return Response.json(result);
}
